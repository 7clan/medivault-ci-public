//! HTTP GET /health probe over a raw TCP connection.
//!
//! The supervisor deliberately does NOT link an HTTP client crate: the API
//! contract is "GET /health returns HTTP 200 within the poll budget", and a
//! five-line HTTP/1.1 request over `std::net::TcpStream` proves exactly
//! that while keeping the Mach-O dependency surface at libSystem-only.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// One attempt: connect (2s), send GET, read response head.
/// Returns the HTTP status code, or Err on transport failure.
pub fn get_health(host: &str, port: u16) -> Result<u16, String> {
    let addr: SocketAddr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve {host}:{port}: {e}"))?
        .next()
        .ok_or_else(|| format!("no address for {host}:{port}"))?;

    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|e| format!("connect {host}:{port}: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set write timeout: {e}"))?;

    let req = format!(
        "GET /health HTTP/1.1\r\nHost: {host}:{port}\r\nUser-Agent: medivault-supervisor\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write request: {e}"))?;

    let mut head = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    // Read the status line only (up to first \n); the body is irrelevant.
    loop {
        match stream.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                head.push(byte[0]);
                if byte[0] == b'\n' || head.len() > 256 {
                    break;
                }
            }
            Err(e) => {
                // A timeout mid-line still means "we got a server" only if
                // we already have a status line; treat as transport error.
                if head.is_empty() {
                    return Err(format!("read response: {e}"));
                }
                break;
            }
        }
    }
    let line = String::from_utf8_lossy(&head);
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("malformed status line: {}", line.trim()))?;
    Ok(status)
}

/// Bounded poll until /health answers 200.
pub fn wait_api_healthy(
    host: &str,
    port: u16,
    timeout: std::time::Duration,
) -> Result<bool, String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match get_health(host, port) {
            Ok(200) => return Ok(true),
            Ok(_non_200) => {
                // 503 while Fastify boots / probes DB — keep polling.
            }
            Err(_transport) => {
                // Connection refused while the child boots — keep polling.
            }
        }
        if std::time::Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_status_line_from_real_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 512];
            let _ = sock.read(&mut buf);
            let _ = sock.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}",
            );
        });
        let code = super::get_health("127.0.0.1", port).unwrap();
        assert_eq!(code, 200);
        server.join().unwrap();
    }

    #[test]
    fn refused_port_is_transport_error() {
        // Bind then drop to (almost certainly) free a port.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let result = super::get_health("127.0.0.1", port);
        assert!(result.is_err());
    }
}

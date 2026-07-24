const https = require('https');
const net = require('net');
const tls = require('tls');

const PROXY_API = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all&ssl=all&anonymity=all';

function fetchProxies() {
    return new Promise((resolve, reject) => {
        https.get(PROXY_API, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const list = data.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && line.includes(':'));
                resolve(list);
            });
        }).on('error', reject);
    });
}

function testSocks5(proxyIp, proxyPort, targetHost, targetPort) {
    return new Promise((resolve) => {
        const socket = net.connect({
            port: Number(proxyPort),
            host: proxyIp,
            timeout: 5000
        });

        socket.on('connect', () => {
            // Socks5 Handshake: ver=5, nmethods=1, method=00 (no auth required)
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        let step = 0;
        socket.on('data', (chunk) => {
            if (step === 0) {
                // Handshake response: ver=5, method=00
                if (chunk[0] === 0x05 && chunk[1] === 0x00) {
                    step = 1;
                    // CONNECT request to targetHost:targetPort
                    const hostBuf = Buffer.from(targetHost);
                    const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
                    req[0] = 0x05; // ver
                    req[1] = 0x01; // cmd: connect
                    req[2] = 0x00; // rsv
                    req[3] = 0x03; // atyp: domain name
                    req[4] = hostBuf.length; // domain len
                    hostBuf.copy(req, 5);
                    req.writeUInt16BE(targetPort, 5 + hostBuf.length);
                    socket.write(req);
                } else {
                    socket.destroy();
                    resolve(false);
                }
            } else if (step === 1) {
                // CONNECT response: ver=5, rep=00 (success)
                if (chunk[0] === 0x05 && chunk[1] === 0x00) {
                    step = 2;
                    // Tunel Socks5 zestawiony. Teraz rozpoczynamy uścisk dłoni TLS (SSL)
                    socket.removeAllListeners('data');
                    socket.removeAllListeners('timeout');
                    socket.removeAllListeners('error');

                    const tlsSocket = tls.connect({
                        socket: socket,
                        servername: targetHost,
                        rejectUnauthorized: false
                    }, () => {
                        // Handshake TLS udany! Wysyłamy zapytanie HTTP GET
                        tlsSocket.write(`GET / HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nConnection: close\r\n\r\n`);
                    });

                    tlsSocket.setTimeout(4000);

                    tlsSocket.on('data', (data) => {
                        const response = data.toString();
                        // Jeśli otrzymaliśmy poprawną odpowiedź HTTP, oznacza to, że Cloudflare nie zerwał połączenia TLS
                        if (response.includes('HTTP/') && (response.includes(' 200') || response.includes(' 301') || response.includes(' 302') || response.includes(' 403'))) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                        tlsSocket.destroy();
                    });

                    tlsSocket.on('timeout', () => {
                        tlsSocket.destroy();
                        resolve(false);
                    });

                    tlsSocket.on('error', () => {
                        tlsSocket.destroy();
                        resolve(false);
                    });
                } else {
                    socket.destroy();
                    resolve(false);
                }
            }
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

async function main() {
    console.log('Pobieranie listy darmowych proxy Socks5...');
    const proxies = await fetchProxies();
    console.log(`Pobrano ${proxies.length} proxy. Rozpoczynam testy połączeń TLS do www.margonem.pl:443...`);

    const working = [];
    const batchSize = 40;
    for (let i = 0; i < proxies.length; i += batchSize) {
        const batch = proxies.slice(i, i + batchSize);
        console.log(`Testowanie grupy ${i + 1} do ${i + batch.length}...`);
        await Promise.all(batch.map(async (p) => {
            const [ip, port] = p.split(':');
            const ok = await testSocks5(ip, port, 'www.margonem.pl', 443);
            if (ok) {
                console.log(`   [+] Znalazłem działające proxy (pełny TLS OK): socks5://${p}`);
                working.push(p);
            }
        }));
        if (working.length >= 5) {
            console.log('\nZnaleziono działające proxy (przetestowane TLS/Cloudflare):');
            working.forEach(p => console.log(`socks5://${p}`));
            break;
        }
    }
}

main().catch(console.error);

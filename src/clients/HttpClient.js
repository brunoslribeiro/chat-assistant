import axios from 'axios';
import http from 'http';
import https from 'https';

// Axios singleton with keep-alive to reduce TLS handshakes and latency
export const httpClient = axios.create({
  timeout: 30000,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 })
});

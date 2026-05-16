const os = require('os');
const app = require('../server');

const port = Number(process.env.PORT) || 3000;
const host = process.env.WEBSTOCK_HOST || '0.0.0.0';

function localIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal)
    .map(item => item.address);
}

app.listen(port, host, function() {
  console.log('WebStock Android/PWA LAN mode started.');
  console.log('Windows local: http://127.0.0.1:' + port + '/');
  localIPv4Addresses().forEach(function(address) {
    console.log('Android same-LAN: http://' + address + ':' + port + '/');
  });
  console.log('On Android Chrome, open the LAN URL and use Add to Home screen.');
});

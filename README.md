# Hall-E

## Usage

A simple echo bot

```javascript
var client = new HallClient('account@hall.com', 'password');
client.on('connect', function(){
  console.log('Client connected');
  client.joinRoom(client.rooms[0]._id);
  client.once('message', function(m){
    client.postMessage(m.message.plain, console.log);
  });
});
```
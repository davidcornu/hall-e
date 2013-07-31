# Hall-E

## Warning

This library was written for the sole purpose of implementing bots for
[Hall](https://hall.com) chatrooms.

As they don't provide a public API (hint hint, nudge nudge), all of the
functionality was implemented by reverse engineering the web client and will
probably break when someone over there decides to rename a couple of divs.

Use at your own peril.

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
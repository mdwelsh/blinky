// Firebase Cloud Functions for the Blinky DialogFlow app.
// To deploy: firebase deploy --only functions

const functions = require('firebase-functions');
const {dialogflow} = require('actions-on-google');
const colors = require('./colors');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

// DialogFlow intents. Note that these do not get configured automatically;
// you must go into the DialogFlow console and add intents with these names
// and corresponding training phrases by hand.
const app = dialogflow();

// Dummy intent for testing.
app.intent('Try me', conv => {
  console.log('Try me intent invoked.');
  conv.ask('You wanted to try me. Okay then.');
});

// Set the given 'elem' on each device to 'val'.
function setAllDevices(elem, val) {
  var allKeys = [];
  var stripsQuery = admin.database().ref("strips").orderByKey();
  return stripsQuery
    .once("value")
    .then(function(snapshot) {
      console.log('Iterating over all devices');
      snapshot.forEach(function(childSnapshot) {
        var key = childSnapshot.key;
        allKeys.push(key);
      });
    })
    .then(function() {
      allKeys.forEach(function(key) {
        console.log('Setting device ' + key + ' elem ' + elem + ' to ' + val);
          var elemRef = admin.database().ref("strips/" + key + "/" + elem);
          return elemRef
            .set(val)
            .then(function() {
              console.log('Set device ' + key);
            });
        });
      })
      .then(function() {
        console.log('Done setting all devices.');
      });
}


// Return the key for the device with the given name, or null otherwise.
function getDeviceByName(name) {
  return getDeviceConfigs().then(function(configs) {
    for (let config of configs) {
      if (config.value.name.toLowerCase() == name.toLowerCase()) {
        return config.key;
      }
    }
    return null;
  });
}

// Return the set of keys for all devices matching the given group.
function getGroup(group) {
  return getDeviceConfigs().then(function(configs) {
    var keys = [];
    for (let config of configs) {
      if (config.value.group.toLowerCase() == group.toLowerCase()) {
        keys.push(config.key);
      }
    }
    return keys;
  });
}

// Set config element elem on device with key to val.
function setDeviceConfigByKey(key, elem, val) {
  var elemRef = admin.database().ref("strips/" + key + "/" + elem);
  return elemRef
    .set(val)
    .then(function() {
      console.log('Set device ' + key + ' elem ' + elem + ' to ' + val);
    });
}

// Set config element elem on the named device or group to val.
function setDeviceConfigByNameOrGroup(name, field, fieldVal) {
  // First try matching a specific device name.
  return getDeviceByName(name).then(function(key) {
    if (key != null) {
      return setDeviceConfigByKey(key, field, fieldVal);
    } else {
      // Next try matching a group.
      return getGroup(name).then(function(keys) {
        if (keys.length == 0) {
          return Promise.reject(new Error('No such device or group ' + name));
        }

        // Run the setDevice promises in parallel.
        promises = [];
        for (let key of keys) {
          promises.push(setDeviceConfigByKey(key, field, fieldVal));
        }
        return Promise.all(promises);
      });
    }
  });
}

// Return list of {key, value} for each device checkin.
function getDeviceCheckins() {
  var checkins = [];
  var checkinsQuery = admin.database().ref("checkin").orderByKey();
  return checkinsQuery
    .once("value")
    .then(function(snapshot) {
      snapshot.forEach(function(childSnapshot) {
        var key = childSnapshot.key;
        var value = childSnapshot.val();
        checkins.push({key: key, value: value});
      });
    })
    .then(function() {
      return checkins;
    });
}

// Return list of {key, value} for device config.
function getDeviceConfigs() {
  var strips = [];
  var stripsQuery = admin.database().ref("strips").orderByKey();
  return stripsQuery
    .once("value")
    .then(function(snapshot) {
      snapshot.forEach(function(childSnapshot) {
        var key = childSnapshot.key;
        var value = childSnapshot.val();
        strips.push({key: key, value: value});
      });
    })
    .then(function() {
      return strips;
    });
}

app.intent('Enable all', conv => {
  console.log('Enable all intent invoked.');
  var globals = admin.database().ref("globals");
  return globals.set({
    allEnabled: true
  }).then(function() {
    return setAllDevices('enabled', true)
    .then(function() {
      conv.ask('Okay, all Blinky devices have been enabled.');
    });
  });
});

app.intent('Disable all', conv => {
  console.log('Disable all intent invoked.');
  var globals = admin.database().ref("globals");
  return globals.set({
    allEnabled: false
  }).then(function() {
    return setAllDevices('enabled', false)
    .then(function() {
      conv.ask('Okay, all Blinky devices have been disabled.');
    });
  });
});

app.intent('List devices', conv => {
  console.log('List devices intent invoked.');
  response = 'Here are the Blinky devices that I know about: ';
  var stripsQuery = admin.database().ref("strips").orderByKey();
  return stripsQuery
    .once("value")
    .then(function(snapshot) {
      console.log('Got snapshot for strips.');
      snapshot.forEach(function(childSnapshot) {
        console.log('Adding key ' + childSnapshot.key + ' to response.');
        var key = childSnapshot.key;
        var val = childSnapshot.val();
        if ('name' in val) {
          response += val.name + ', ';
        } else {
          response += 'unnamed with key ' + key + ', ';
        }
      });
    }).then(function() {
      console.log('Responding with: ' + response);
      conv.ask(response);
    });
});

app.intent('Describe', (conv, {deviceName}) => {
  console.log('Describe intent invoked with '+deviceName);
  return getDeviceCheckins().then(function(checkins) {
    console.log('Got ' + checkins.length + ' checkins');
    console.log(checkins);

    var response = "I'm sorry, but I don't know about the device named "
      + deviceName + ". Here is the list of devices I know about: ";
    for (let entry of checkins) {
      var key = entry.key;
      var checkin = entry.value;
      var config = checkin.config;
      if ('name' in config) {
        response += config.name + ', ';
      }
    }
    response += '. ';

    for (let entry of checkins) {
      var key = entry.key;
      var checkin = entry.value;
      var config = checkin.config;
      var ts = checkin.timestamp;
      var d = new Date(ts);

      if (config.name.toLowerCase() == deviceName.toLowerCase()) {
        response = 'Here is the configuration for ' + deviceName +'. ';
        response += deviceName + ' last checked in on ' + d.toDateString() +
          ' at ' + d.toTimeString() + '. ';
        response += deviceName + ' has a MAC address of ' + checkin.mac +
          ' and an IP address of ' + checkin.ip + '. ';
        response += 'Its current RSSI value is ' + checkin.rssi + ' dBm. ';
        if (config.enabled) {
          response += 'This device is enabled. ';
        } else {
          response += 'This device is not enabled. ';
        }
        response += 'Its current mode is ' + config.mode + '. ';
        break;
      }
    }
    conv.ask(response);
  });
});

app.intent('Set mode', (conv, {deviceName, mode, color}) => {
  console.log('Set mode intent invoked with '
    + ' device:' + deviceName
    + ' mode:' + mode
    + ' color:' + color);

  if (color != '') {
    // Set color.
    var rgb = colors.getColor(color);
    console.log('Color parsed as ' + JSON.stringify(rgb));

    if (rgb == null) {
      conv.ask("I don't know the color " + color);
      return;
    }
    var promises = [
      setDeviceConfigByNameOrGroup(deviceName, 'red', rgb.red),
      setDeviceConfigByNameOrGroup(deviceName, 'green', rgb.green),
      setDeviceConfigByNameOrGroup(deviceName, 'blue', rgb.blue),
    ];
    return Promise.all(promises)
      .then(function() {
        console.log('Set color promises complete');
        conv.ask('Okay, I set ' + deviceName + ' to the color ' + color);
      })
      .catch(function(e) {
        console.log('Set color promises failed: ' + e);
        conv.ask(e.message);
      });

  } else if (mode != '') {
    // Set mode.
    console.log('Setting mode: ' + mode);
    return setDeviceConfigByNameOrGroup(deviceName, 'mode', mode)
      .then(function() {
        console.log('Set mode promise complete');
        conv.ask('Okay, I set ' + deviceName + ' to mode ' + mode);
      })
      .catch(function(e) {
        console.log('Set mode promise failed: ' + e);
        conv.ask(e.message);
      });

  } else {
    conv.ask('You need to specify either a mode name or a color.');
    return;
  }
});


exports.dialogFlowApp = functions.https.onRequest(app);

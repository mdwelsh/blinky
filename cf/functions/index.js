// Firebase Cloud Functions for the Blinky DialogFlow app.
// To deploy: firebase deploy --only functions

const functions = require('firebase-functions');
const {dialogflow} = require('actions-on-google');

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

app.intent('Enable all', conv => {
  console.log('Enable all intent invoked.');
  var globals = admin.database().ref("globals");
  return globals.set({
    allEnabled: true
  }).then(function() {
    conv.ask('Okay, all Blinky devices have been enabled.');
  });
});

app.intent('Disable all', conv => {
  console.log('Disable all intent invoked.');
  var globals = admin.database().ref("globals");
  return globals.set({
    allEnabled: false
  }).then(function() {
    conv.ask('Okay, all Blinky devices have been disabled.');
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

exports.dialogFlowApp = functions.https.onRequest(app);

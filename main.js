/* Team Sidney Light Controller - Main Javascript code */

/* Firebase rules are set up to allow public REST access to read
 * the strips entries in the database. The value of a strip with
 * ID "strip3" can be accessed via:
 * 
 * https://team-sidney.firebaseio.com/strips/strip3.json
 *
 * which returns a JSON-encoded string for the value (e.g., "Off"), with
 * the quotes around it.
 */

/* Set to true to stub out authentication code. */
var FAKE_AUTH = false;
var SIDNEY_PHOTO = "http://howtoprof.com/profsidney.jpg";
var provider = new firebase.auth.GoogleAuthProvider();
var fakeUser = null;

// Mapping from strip-ID to object maintaining strip state.
var allStrips = {};

// List of supported modes.
var allmodes = [
  'off',
  'random',
  'wipe',
  'theater',
  'bounce',
  'rainbow',
  'rainbowcycle',
  'spackle',
  'fire',
  'candle',
  'flicker',
  'phantom',
  'strobe',
  'rain',
  'comet',
];

// Global variables to be maintained in Firebase.
var globals = {};

// Known firmware versions.
var firmwareVersions = {};

// Database references.
var logRef = null;
var globalsRef = null;
var firmwareVersionsRef = null;
var storageRef = null;

// Initialize click handlers.
$('#login').off('click');
$('#login').click(doLogin);
$('#logout').off('click');
$('#logout').click(logout);
$('#showLogButton').click(function () {
  $("#log").toggle();
});
$('#enableAll').change(enableAllToggled);

initEditor();
setup();

// MDW TESTING STORAGE STUFF
/*
var storage = firebase.storage();
var storageRef = storage.ref();
var fwRef = storageRef.child('Blinky.ino.bin');
var fwUrl = fwRef.getDownloadURL().then(function(fwUrl) {
  console.log('Firmware URL: ');
  console.log(fwUrl);

  var xhr = new XMLHttpRequest();
  xhr.responseType = 'arraybuffer';
  xhr.onload = function(event) {
    var arrayBuffer = xhr.response;
    var byteArray = new Uint8Array(arrayBuffer);
    console.log('Received:');
    console.log(byteArray);
    var enc = new TextDecoder("utf-8");
    var s = enc.decode(byteArray);
    var re = new RegExp("__Bl!nky__ [^_]+ ___");
    var result = re.exec(s);
    console.log("Matched:");
    console.log(result[0]); // MDW THIS IS IT!!!
  };
  xhr.open('GET', fwUrl);
  xhr.send();
  console.log('Done with fw fetch');

  var reader = new FileReader();
});
*/

function initEditor() {
  var editor = $("#editorMode");

  // Populate mode dropdown.
  var select = $("#editorModeSelect");
  allmodes.forEach(function(mode) {
    $('<option/>')
      .text(mode)
      .appendTo(select);
  });

  // Fix up UI components for the rest of the editor.
  $("#editorSpeedSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 200,
    value: 100,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorBrightnessSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 255,
    value: 128,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#red, #green, #blue").slider({
    orientation: "horizontal",
    range: "min",
    max: 255,
    value: 127,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorColorChangeSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 0,
    max: 100,
    value: 0,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  $("#editorNumPixelsSlider").slider({
    orientation: "horizontal",
    range: "min",
    min: 72,
    max: 200,
    value: 120,
    slide: refreshSwatch,
    change: refreshSwatch
  });
  refreshSwatch();

  // Editor UI completion actions.
  $('#editorSave').click(function (e) {
    $("#editor").get()[0].close();
    var id = $("#editorStripId").text();
    editStripDone(id, false);
  });
  $('#editorSaveAll').click(function (e) {
    $("#editor").get()[0].close();
    $.each(allStrips, function(id, strip) {
      editStripDone(id, true);
    });
  });
  $('#editorCancel').click(function (e) {
    $("#editor").get()[0].close();
  });
  $('#editorClose').click(function (e) {
    $("#editor").get()[0].close();
  });

  // Delete device actions.
  $('#deleteStripConfirm').click(function (e) {
    $("#deleteStrip").get()[0].close();
    deleteStripDone();
  });
  $('#deleteStripCancel').click(function (e) {
    $("#deleteStrip").get()[0].close();
  });
  $('#deleteStripClose').click(function (e) {
    $("#deleteStrip").get()[0].close();
  });

  // Upload firmware actions.
  $('#firmwareUploadButton').click(function (e) {
    uploadFirmwareStart();
    $("#uploadFirmware").get()[0].showModal();
  });
  $('#uploadFirmwareConfirm').click(function (e) {
    $("#uploadFirmware").get()[0].close();
    firmwareUploadDone();
  });
  $('#uploadFirmwareCancel').click(function (e) {
    $("#uploadFirmware").get()[0].close();
  });
  $('#uploadFirmwareClose').click(function (e) {
    $("#uploadFirmware").get()[0].close();
  });
  $('#uploadFirmwareFile').change(function() {
    var file = $('#uploadFirmwareFile')[0].files[0];
    uploadFirmware(file);
  });

  // Delete firmware actions.
  $('#deleteFirmwareConfirm').click(function (e) {
    $("#deleteFirmware").get()[0].close();
    deleteFirmwareDone();
  });
  $('#deleteFirmwareCancel').click(function (e) {
    $("#deleteFirmware").get()[0].close();
  });
  $('#deleteFirmwareClose').click(function (e) {
    $("#deleteFirmware").get()[0].close();
  });
}

// Called when editor opened for a strip.
function editStripStart(id) {
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Warning - editing unknown strip " + id);
    return;
  }
  $("#editorStripId").text(id);

  // Populate firmware version dropdown.
  var fwselect = $("#editorFirmwareSelect");
  fwselect.empty();
  $('<option/>')
    .text('current')
    .appendTo(fwselect);
  for (var fw in firmwareVersions) {
    $('<option/>')
      .text(fw)
      .appendTo(fwselect);
  }

  // Prefer initializing dialog to nextConfig if it exists, otherwise
  // fall back to curConfig.
  var config = null;
  if (strip.nextConfig == null) {
    if (strip.curConfig == null) {
      console.log("Warning - no cur or next config for strip yet: " + id);
      return;
    } else {
      config = strip.curConfig;
    }
  } else {
    config = strip.nextConfig;
  }
  console.log(config);

  $("#editorNameField").val(config.name);
  // XXX MDW - Need to fix label overlapping with text.
  //$("#editorName")[0].MaterialTextField.change();
  
  $("#editorModeSelect").val(config.mode);
  $("#editorFirmwareSelect").val(config.version);
  $("#editorSpeedSlider").slider("value", config.speed);
  $("#editorBrightnessSlider").slider("value", config.brightness);
  $("#editorColorChangeSlider").slider("value", config.colorChange);
  if (config.numPixels != undefined) {
    $("#editorNumPixelsSlider").slider("value", config.numPixels);
  }
  $("#red").slider("value", config.red);
  $("#green").slider("value", config.green);
  $("#blue").slider("value", config.blue);
}

// Called when editing done.
function editStripDone(id, editAll) {
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Can't edit unknown strip: " + id);
    return;
  }

  // Extract values from modal.
  //
  // For some fields, if we are doing a global edit, don't override
  // with the editor's values.
  var name;
  var numPixels;
  if (editAll) {
    name = strip.nextConfig.name;
    numPixels = strip.curConfig.numPixels;
  } else {
    name = $("#editorNameField").val();
    numPixels = $("#editorNumPixelsSlider").slider("value");
  }
    
  var version = $("#editorFirmwareSelect").find(':selected').text();
  var mode = $("#editorModeSelect").find(':selected').text();
  var speed = $("#editorSpeedSlider").slider("value");
  var brightness = $("#editorBrightnessSlider").slider("value");
  var colorChange = $("#editorColorChangeSlider").slider("value");
  var red = $("#red").slider("value");
  var green = $("#green").slider("value");
  var blue = $("#blue").slider("value");
  var newConfig = {
    version: version,
    name: name,
    mode: mode,
    speed: speed,
    brightness: brightness,
    colorChange: colorChange,
    numPixels: numPixels,
    red: red,
    green: green,
    blue: blue,
  };
  setConfig(id, newConfig);
}

// Color picker.
function hexFromRGB(r, g, b) {
  var hex = [
    r.toString( 16 ),
    g.toString( 16 ),
    b.toString( 16 )
  ];
  $.each(hex, function( nr, val) {
    if ( val.length === 1 ) {
      hex[nr] = "0" + val;
    }
  });
  return hex.join( "" ).toUpperCase();
}

function refreshSwatch() {
  var red = $("#red").slider("value");
  var green = $("#green").slider("value");
  var blue = $("#blue").slider("value");
  var hex = hexFromRGB(red, green, blue);
  $("#swatch").css("background-color", "#" + hex);

  var speed = $("#editorSpeedSlider").slider("value");
  $("#speedIndicator").text(speed);
  var brightness = $("#editorBrightnessSlider").slider("value");
  $("#brightnessIndicator").text(brightness);
  var colorChange = $("#editorColorChangeSlider").slider("value");
  $("#colorChangeIndicator").text(colorChange);
  var numPixels = $("#editorNumPixelsSlider").slider("value");
  $("#numPixelsIndicator").text(numPixels);
}

// Set up initial UI elements.
function setup() {
  if (currentUser() == null) {
    // Not logged in yet.
    showLoginButton();
    logRef = null;
    globalsRef = null;
    firmwareVersionsRef = null;

    $("#log").empty();
    $("#striplist").empty();
    $("#firmwarelist").empty();

  } else {
    showFullUI();
    $("#devices-tab-button")[0].click();

    checkinRef = firebase.database().ref('checkin/');
    checkinRef.on('child_added', stripCheckin, dbErrorCallback);
    checkinRef.on('child_changed', stripCheckin, dbErrorCallback);

    logRef = firebase.database().ref('log/');
    logRef.on('child_added', newLogEntry, dbErrorCallback);

    globalsRef = firebase.database().ref('globals/');
    globalsRef.on('value', globalsChanged, dbErrorCallback);

    firmwareVersionsRef = firebase.database().ref('firmware/');
    firmwareVersionsRef.on('child_added', firmwareUpdated, dbErrorCallback);
    firmwareVersionsRef.on('child_changed', firmwareUpdated, dbErrorCallback);

    var storage = firebase.storage();
    storageRef = storage.ref();
  }
}

// Called when globals/ DB entry changes.
function globalsChanged(snapshot) {
  globals = snapshot.val();

  // Update UI. This is a little wonky and undocumented MDLite behavior.
  var enableAll = $("#enableAll")[0].parentElement.MaterialSwitch;
  if (globals.allEnabled) {
    enableAll.on();
  } else {
    enableAll.off();
  }

  // Note that any changes to the configs is done when the button is toggled.
}

// Called when firmware/ DB entry changes.
function firmwareUpdated(snapshot) {
  var fwVersion = snapshot.key;
  var fwData = snapshot.val();
  console.log('Adding new firmware version: ' + fwVersion);
  console.log(fwData);

  var fw = firmwareVersions[fwVersion];
  if (fw == null) {
    // This is a new firmware version.
    createFirmwareVersion(fwVersion);
  }

  // Otherwise, just update it.
  updateFirmwareVersion(fwVersion, fwData);
}

function createFirmwareVersion(fwVersion) {
  // Create dummy firmware object.
  var index = firmwareVersions.length;
  index += 1;
  var fw = {
    version: fwVersion,
    index: index,
  };
  firmwareVersions[fwVersion] = fw;

  // Create UI card.
  var container = $('#firmwarelist');
  var cardline = $('<div/>')
    .addClass('firmware-line')
    .appendTo(container);
  fw.cardElem = cardline;

  var card = $('<div/>')
    .addClass('firmware-card')
    .addClass('mdl-card')
    .addClass('mdl-shadow--2dp')
    .attr('id', 'firmware-'+index)
    .appendTo(cardline);
  var cardtitle = $('<div/>')
    .attr('id', 'firmware-title')
    .addClass('mdl-card__title')
    .appendTo(card);
  var cardbody = $('<div/>')
    .addClass('mdl-card__supporting-text')
    .appendTo(card);

  var tl = $('<div/>')
    .addClass('firmware-title-line')
    .appendTo(cardtitle);
  var sid = $('<div/>')
    .addClass('firmware-id')
    .text(fwVersion)
    .appendTo(tl);

  // Status area.
  var statusArea = $('<div/>')
    .addClass('container')
    .addClass('firmware-status')
    .appendTo(cardbody);

  $('<div/>')
    .text('Date uploaded')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'date')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('File')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'url')
    .text('unknown')
    .appendTo(statusArea);

  // Button group.
  var bg = $('<div/>')
    .addClass('firmware-card-buttons')
    .appendTo(card);

  $('<button/>')
    .attr('type', 'button')
    .attr('id', 'firmwareDeleteButton')
    .addClass('mdl-button')
    .addClass('mdl-js-button')
    .addClass('mdl-button--icon')
    .append($('<i/>').addClass('material-icons').text('delete'))
    .click(function() {
      deleteFirmwareStart(fwVersion);
      $("#deleteFirmware").get()[0].showModal();
    })
    .appendTo(bg);
  
  // Needed for MD Lite to kick in.
  componentHandler.upgradeElements(card.get());
  return fw;
}

function updateFirmwareVersion(fwVersion, fwData) {
  var fw = firmwareVersions[fwVersion];
  if (fw == null) {
    return;
  }

  // Update local state.
  fw.hash = fwData.hash;
  fw.url = fwData.url;
  fw.dateUploaded = fwData.dateUploaded;

  // Update the UI.
  var e = fw.cardElem;
  $(e).find('#firmware-title').effect('highlight');

  $(e).find('#hash').text(fw.hash);
  var link = $('<a/>')
    .attr('href', fw.url)
    .text(fw.url);
  $(e).find('#url').empty();
  $(e).find('#url').append(link);

  var m = new moment(fw.dateUploaded);
  dateString = m.format('MMM DD, h:mm:ss a') + ' (' + m.fromNow() + ')';
  $(e).find('#date').text(dateString);
}

var uploadedFile = null;
var uploadedFirmwareVersion = null;
var uploadedFirmwareUrl = null;

function uploadFirmwareStart() {
  $('#uploadFirmwareSelectedFile').empty();
  $('#uploadFirmwareError').empty();
  $('#uploadFirmwareVersion').empty();
  $('#uploadFirmwareLink').empty();
  $('#uploadFirmwareSpinner').hide();
}

function uploadFirmware(file) {
  uploadedFile = file;
  $('#uploadFirmwareConfirm').prop('disabled', true); 
  $('#uploadFirmwareSelectedFile').text('File: ' + file.name);
  $('#uploadFirmwareError').empty();
  $('#uploadFirmwareVersion').empty();
  $('#uploadFirmwareLink').empty();

  var reader = new FileReader();
  reader.onloadend = function() {
    uploadFirmwareFinished(reader.result);
  }
  reader.readAsArrayBuffer(file);
}

function getFirmwareVersion(data) {
  var enc = new TextDecoder("utf-8");
  var s = enc.decode(data);
  var re = new RegExp("__Bl!nky__ [^_]+ ___");
  var result = re.exec(s);
  if (result == null) {
    return null;
  }
  return result[0];
}

function uploadFirmwareFinished(data) {
  uploadedFirmwareVersion = getFirmwareVersion(data);
  if (uploadedFirmwareVersion == null) {
    $('#uploadFirmwareError')
      .text('File missing magic version string. Is this a Blinky binary?');
    uploadedFirmware = null;
    return;
  }

  // Valid binary - make it possible to add.
  console.log('Got firmware version: ' + uploadedFirmwareVersion);
  $('#uploadFirmwareVersion').text('Version string: ' + uploadedFirmwareVersion);
  $('#uploadFirmwareConfirm').prop('disabled', false);

  // Start the upload.
  $('#uploadFirmwareSpinner').show();
  var fname = uploadedFile.name + ' ' + uploadedFirmwareVersion;
  console.log('Starting upload of ' + fname);
  var uploadRef = storageRef.child(fname);
  uploadRef.put(uploadedFile).then(function(snapshot) {
    // Upload done.
    $('#uploadFirmwareSpinner').hide();
    console.log('Upload complete');
    // Add link.
    uploadRef.getDownloadURL().then(function(url) {
      uploadedFirmwareUrl = url;
      $('#uploadFirmwareLink').html('Uploaded: <a href="'+url+'">'+fname+'</a>');
    });
  });
}

function firmwareUploadDone() {
  var dbRef = firebase.database().ref('firmware/' + uploadedFirmwareVersion);
  var metadata = {
    dateUploaded: firebase.database.ServerValue.TIMESTAMP,
    version: uploadedFirmwareVersion,
    filename: uploadedFile.name + ' ' + uploadedFirmwareVersion,
    url: uploadedFirmwareUrl,
  };
  dbRef.set(metadata).then(function() {
    addLogEntry('added firmware '+uploadedFirmwareVersion);
  })
  .catch(function(error) {
    $('#uploadFirmwareError').text(error.message);
  });
}

function deleteFirmwareStart(version) {
  $("#deleteFirmwareVersion").text(version);
}

function deleteFirmwareDone() {
  // XXX TODO - Get version number from UI and delete it.
}

function currentUser() {
  if (FAKE_AUTH) {
    return fakeUser;
  } else {
    return firebase.auth().currentUser;
  }
}

// Called when there is an error reading the database.
function dbErrorCallback(err) {
  // Ignore the error if not logged in yet.
  if (currentUser() != null) {
    showError($('#dberror'), err.message);
  }
}

// Clear error.
function clearError(elem) {
  elem.text('');
  elem.hide();
}

// Show error.
function showError(elem, msg) {
  elem.text(msg);
  elem.show();
}

// Show the login button.
function showLoginButton() {
  $('#login').show();
  $('#postlogin').hide();
  $('#logout').hide();
}

function doLogin() {
  if (FAKE_AUTH) {
    fakeUser = {
      displayName: "Fakey McFakerson",
      photoURL: SIDNEY_PHOTO,
      email: "fake@teamsidney.com",
    };
    showFullUI();
  } else {
    firebase.auth().signInWithPopup(provider).then(function(result) {
    }).catch(function(error) {
      showError($('#loginerror'),
                'Sorry, could not log you in: ' + error.message);
    });
  }
}

// Show the full UI.
function showFullUI() {
  // Update header.
  $('#login').hide();
  $('#logout').show();

  $("#log").empty();
  $("#striplist").empty();
  $("#firmwarelist").empty();
}

// Callback invoked when database returns new value for a strip.
function stripCheckin(snapshot) {
  var stripid = snapshot.key;
  updateStrip(stripid, snapshot.val());
}

// Update the local strip state with the received data from checkin.
function updateStrip(id, stripdata) {
  var strip = allStrips[id];
  if (strip == null) {
    // This is a new strip.
    strip = createStrip(id);
    if (strip == null) {
      console.log('Bug - Unable to create strip ' + id);
      return;
    }
  }

  // Update local state.
  strip.curConfig = stripdata.config;
  strip.ip = stripdata.ip;
  strip.rssi = stripdata.rssi;
  strip.lastCheckin = new Date(stripdata.timestamp);
  strip.version = stripdata.version;

  // Now update the UI.
  var e = strip.stripElem;
  $(e).find('#strip-title').effect('highlight');

  var mode = "unknown";
  if (stripdata.config != null && stripdata.config.mode != null) {
    mode = stripdata.config.mode;
  }
  $(e).find('#curMode').text(configToString(stripdata.config));

  if (JSON.stringify(strip.curConfig) === JSON.stringify(strip.nextConfig)) {
    $(e).find("#nextMode").removeClass('pending');
  } else {
    $(e).find("#nextMode").addClass('pending');
  }
  $(e).find('#ip').text(stripdata.ip);
  $(e).find('#version').text(stripdata.version);
  $(e).find('#rssi').text(stripdata.rssi + ' dBm');
  var m = new moment(strip.lastCheckin);
  dateString = m.format('MMM DD, h:mm:ss a') + ' (' + m.fromNow() + ')';
  $(e).find('#checkin').text(dateString);
}

// Return a string that is safe to use as an element ID
// (in this case, replace ':' with '')
function safeIdString(id) {
  return id.replace(/:/g, '');
}

// Create a strip with the given ID.
function createStrip(id) {
  var dbRef = firebase.database().ref('strips/' + id);
  dbRef.on('value', configUpdate, dbErrorCallback);

  var strip = {
    id: id,
    stripElem: strip,
    dbRef: dbRef,
    curConfig: {
      mode: "unknown",
      enabled: false,
    },
    nextConfig: {
      mode: "unknown",
      enabled: false,
    },
  };
  allStrips[id] = strip;

  var container = $('#striplist');
  var cardline = $('<div/>')
    .addClass('strip-line')
    .appendTo(container);
  strip.stripElem = cardline;

  var card = $('<div/>')
    .addClass('strip-card')
    .addClass('mdl-card')
    .addClass('mdl-shadow--2dp')
    .attr('id', 'stripline-strip-'+id)
    .appendTo(cardline);
  var cardtitle = $('<div/>')
    .attr('id', 'strip-title')
    .addClass('mdl-card__title')
    .appendTo(card);
  var cardbody = $('<div/>')
    .addClass('mdl-card__supporting-text')
    .appendTo(card);

  var tl = $('<div/>')
    .addClass('strip-title-line')
    .appendTo(cardtitle);

  var sid = $('<div/>')
    .addClass('strip-id')
    .text(id)
    .appendTo(tl);

  var spc = $('<div/>')
    .addClass('strip-title-space')
    .appendTo(tl);

  var sw = $('<div/>')
    .addClass('strip-title-switch')
    .appendTo(tl);

  var lbl = $('<label/>')
     .addClass('mdl-switch')
     .addClass('mdl-js-switch')
     .addClass('mdl-js-ripple-effect')
     .attr('for', 'strip-enable-'+safeIdString(id))
     .appendTo(sw);
  var inp = $('<input/>')
    .attr('type', 'checkbox')
    .attr('id', 'strip-enable-'+safeIdString(id))
    .addClass('mdl-switch__input')
    .prop('checked', false)
    .click(function(val) {
      setStripEnabled(id, val.currentTarget.checked);
    })
    .appendTo(lbl);
  var ls = $('<span/>')
    .addClass("mdl-switch__label")
    .text('Enable')
    .appendTo(lbl);

  // Status area.
  var statusArea = $('<div/>')
    .addClass('container')
    .addClass('strip-status')
    .appendTo(cardbody);

  $('<div/>')
    .text('Name')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'name')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('Last checkin')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'checkin')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('Firmware version')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'version')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('IP address')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'ip')
    .text('unknown')
    .appendTo(statusArea);
  
  $('<div/>')
    .text('RSSI')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'rssi')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('Current config')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'curMode')
    .text('unknown')
    .appendTo(statusArea);

  $('<div/>')
    .text('Next config')
    .appendTo(statusArea);
  $('<div/>')
    .attr('id', 'nextMode')
    .text('unknown')
    .appendTo(statusArea);

  // Button group.
  var bg = $('<div/>')
    .addClass('strip-card-buttons')
    .appendTo(card);

  var edit = $('<button/>')
    .attr('type', 'button')
    .addClass('mdl-button')
    .addClass('mdl-js-button')
    .addClass('mdl-button--raised')
    .addClass('mdl-js-ripple-effect')
    .text('edit')
    .click(function() {
      editStripStart(id);
      $("#editor").get()[0].showModal();
    })
    .appendTo(bg);

  $('<button/>')
    .attr('type', 'button')
    .attr('id', 'refreshButton')
    .addClass('mdl-button')
    .addClass('mdl-js-button')
    .addClass('mdl-button--icon')
    .append($('<i/>').addClass('material-icons').text('refresh'))
    .appendTo(bg);

  $('<button/>')
    .attr('type', 'button')
    .attr('id', 'deleteButton')
    .addClass('mdl-button')
    .addClass('mdl-js-button')
    .addClass('mdl-button--icon')
    .append($('<i/>').addClass('material-icons').text('delete'))
    .click(function() {
      deleteStripStart(id);
      $("#deleteStrip").get()[0].showModal();
    })
    .appendTo(bg);
  
  // Needed for MD Lite to kick in.
  componentHandler.upgradeElements(card.get());
  return strip;
}

// Called when modal opened for deleting a strip.
function deleteStripStart(id) {
  $("#deleteStripId").text(id);
}

// Called when modal closed for deleting a strip.
function deleteStripDone() {
  var id = $("#deleteStripId").text();
  var strip = allStrips[id];
  if (strip == null) {
    console.log("Can't delete unknown strip: " + id);
    return;
  }
  deleteStrip(id);
}

function deleteStrip(id) {
  var strip = allStrips[id];
  if (strip == null) {
    console.log('No such strip to delete: ' + id);
    return;
  }

  // Remove checkin state.
  cref = firebase.database().ref('checkin/' + id);
  cref.remove()
    .then(function() {
      // Remove strip config state.
      strip.dbRef.remove()
        .then(function() {
          document.getElementById("stripline-strip-"+id).remove();
          allStrips[id] = null;
          addLogEntry("deleted strip " + id);
      });
    });
}

function setStripEnabled(stripid, value) {
  var strip = allStrips[stripid];
  if (strip == null) {
    return;
  }
  var cfg = strip.nextConfig;
  strip.nextConfig.enabled = value;
  setConfig(stripid, strip.nextConfig);
}

function configToString(config) {
  if (config == undefined || config == null) {
    return "not yet known";
  }
  var s = 
    config.numPixels + " pixels, " +
    "enabled: " + config.enabled +
    ", mode: " + config.mode +
    ", speed: " + config.speed +
    ", bright: " + config.brightness +
    ", color: (" + config.red + "," + config.green + "," + config.blue + ")" +
    ", color change: " + config.colorChange;
  return s;
}

// Callback invoked when strip's config has changed from the DB.
function configUpdate(snapshot) {
  var stripid = snapshot.key;
  var nextConfig = snapshot.val();

  var strip = allStrips[stripid];
  if (strip == null) {
    console.log('configUpdate bailing out as strip is not known yet: ' + stripid);
    return;
  }
  var e = strip.stripElem;
  strip.nextConfig = nextConfig;

  // Update UI to reflect received config.
  $(e).find("#name").text(nextConfig.name);
  var nme = $(e).find("#nextMode");
  $(nme).text(configToString(nextConfig));
  if (JSON.stringify(strip.curConfig) === JSON.stringify(nextConfig)) {
    $(nme).removeClass('pending');
  } else {
    $(nme).addClass('pending');
  }

  var enabled = $(e).find("#strip-enable-"+safeIdString(stripid))[0].parentElement.MaterialSwitch;
  if (nextConfig.enabled) {
    enabled.on();
  } else {
    enabled.off();
  }

  $(nme).effect('highlight');
}

// Set the strip's config in the database.
function setConfig(stripid, config) {
  var strip = allStrips[stripid];
  if (strip == null) {
    return;
  }

  // Write current config to the database.
  strip.dbRef.set(config)
    .then(function() {
      addLogEntry('set ' + strip.id + ' to ' + JSON.stringify(config));
    })
    .catch(function(error) {
      showError($('#dberror'), error.message);
    });
}

// Add a new log entry to the database.
function addLogEntry(text) {
  var logRef = firebase.database().ref('log/');
  var entry = logRef.push();
  entry.set({
    'date': new Date().toJSON(),
    'name': currentUser().displayName,
    'text': text,
  });

  if (FAKE_AUTH) {
    showLogEntry(new Date(), currentUser().displayName, text);
  }
}

// Callback invoked when new log entry hits the database.
function newLogEntry(snapshot, preChildKey) {
  clearError($('#dberror'));
  var entry = snapshot.val();
  showLogEntry(new Date(entry.date), entry.name, entry.text);
}

// Show a log entry.
function showLogEntry(date, name, text) {
  var container = $('#log');
  var line = $('<div/>').addClass('log-line').prependTo(container);

  // Log entry.
  var entry = $('<div/>').addClass('log-line-entry').appendTo(line);

  var m = new moment(date);
  var dateString = m.format("ddd, h:mmA");

  $('<span/>')
    .addClass("log-line-date")
    .text(dateString)
    .appendTo(entry);
  $('<span/>')
    .addClass("log-line-name")
    .text(name)
    .appendTo(entry);
  $('<span/>')
    .addClass("log-line-text")
    .text(text)
    .appendTo(entry);
  entry.effect('highlight');
}

function logout() {
  firebase.auth().signOut().then(function() {
    setup(); // Get back to initial state.
  }, function(error) {
    console.log('Problem logging out: ' + error.message);
  });
}

// Callback when signin complete.
firebase.auth().onAuthStateChanged(function(user) {
  setup();
});

// Callback when "Enable all" checkbox is toggled.
function enableAllToggled() {
  var cb = $('#enableAll');

  // Write new globals to the database.
  var newGlobals = {
    allEnabled: cb.is(':checked'),
  };
  globalsRef.set(newGlobals)
    .catch(function(error) {
      showError($('#dberror'), error.message);
    });

  // We don't want to modify the strip configs in the database update callback,
  // since that is also triggered when we first load the page (and we may not
  // have knowledge of the config yet). Here we update
  // the config for each strip that we know about with the new value.
  $.each(allStrips, function(id, strip) {
    var cfg = strip.nextConfig;
    strip.nextConfig.enabled = newGlobals.allEnabled;
    setConfig(id, strip.nextConfig);
  });

}

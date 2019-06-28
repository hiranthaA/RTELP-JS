//client application for lecturer

var server = null;
if(window.location.protocol === 'http:')
	server = "http://" + window.location.hostname + ":8088/janus";
else
	server = "https://" + window.location.hostname + ":8089/janus";


var janus = null;
var screentest = null;
var cameratest = null;
var opaqueId = "screensharingtest-"+Janus.randomString(12);
var recordStreams = false;
var recDir = "/opt/janus/share/janus/recordings";

var myusername = null;
var myid = null;

var capture = null;
var role = "publisher";
var room = null;
var source = null;

var spinner = null;

var doSimulcast = false;
var firstTime = false;
var audioDeviceId = null;
var videoDeviceId = null;


// Just an helper to generate random usernames
function randomString(len, charSet) {
    charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
    	var randomPoz = Math.floor(Math.random() * charSet.length);
    	randomString += charSet.substring(randomPoz,randomPoz+1);
    }
    return randomString;
}

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		Janus.listDevices(initDevices);
		$('#start').one('click', function() {
			$('#btnCameraSettings').removeClass('hide');
			$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				bootbox.alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: server,
					success: function() {
						// Attach screen to video room test plugin
						screenPublisherInit();
						// Attach webcam to video room test plugin
						//webCamPublisherInit();
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
		});
	}});
});

function preShareScreen() {
	if(!Janus.isExtensionEnabled()) {
		bootbox.alert("You're using Chrome but don't have the screensharing extension installed: click <b><a href='https://chrome.google.com/webstore/detail/janus-webrtc-screensharin/hapfgfdkleiggjjpfpenajgdnfckjpaj' target='_blank'>here</a></b> to do so", function() {
			window.location.reload();
		});
		return;
	}
	capture = "screen";
	if(navigator.mozGetUserMedia) {
		// Firefox needs a different constraint for screen and window sharing
		bootbox.dialog({
			title: "Share whole screen or a window?",
			message: "Firefox handles screensharing in a different way: are you going to share the whole screen, or would you rather pick a single window/application to share instead?",
			buttons: {
				screen: {
					label: "Share screen",
					className: "btn-primary",
					callback: function() {
						capture = "screen";
						shareScreen();
					}
				},
				window: {
					label: "Pick a window",
					className: "btn-success",
					callback: function() {
						capture = "window";
						shareScreen();
					}
				}
			},
			onEscape: function() {
				$('#desc').removeAttr('disabled', true);
				$('#create').removeAttr('disabled', true).click(preShareScreen);
				$('#roomid').removeAttr('disabled', true);
				$('#join').removeAttr('disabled', true).click(joinScreen);
			}
		});
	} else {
		shareScreen();
	}
}

function shareScreen() {
	// Create a new room
    var desc = "test-screen-capture";
	role = "publisher";
	var create = { 
		"request": "create", 
		"description": desc, 
		"bitrate": 500000, 
		"publishers": 2, 
		"record": recordStreams, 
		"rec_dir": recDir 
	};
	screentest.send({"message": create, success: function(result) {
		var event = result["videoroom"];
		console.log(event);
		Janus.debug("Event: " + event);
		if(event != undefined && event != null) {
			// Our own screen sharing session has been created, join it
			room = result["room"];
			Janus.log("Screen sharing session created: " + room);
			myusername = randomString(12);
			var register = { "request": "join", "room": room, "ptype": "publisher", "display": "screen_publisher" };
			screentest.send({"message": register});
			// start publishing webcam feed
			webCamPublisherInit();
		}
	}});
}

function screenPublisherInit(){
	janus.attach(
		{
			plugin: "janus.plugin.videoroom",
			opaqueId: opaqueId,
			success: function(pluginHandle) {
				$('#details').remove();
				screentest = pluginHandle;
				Janus.log("Plugin attached! (" + screentest.getPlugin() + ", id=" + screentest.getId() + ")");
				preShareScreen();
				$('#start').removeAttr('disabled').html("Stop Streaming")
					.click(function() {
						$(this).attr('disabled', true);
						janus.destroy();
					});
			},
			error: function(error) {
				Janus.error("  -- Error attaching plugin...", error);
				bootbox.alert("Error attaching plugin... " + error);
			},
			consentDialog: function(on) {
				Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
				if(on) {
					// Darken screen
					$.blockUI({
						message: '',
						css: {
							border: 'none',
							padding: '15px',
							backgroundColor: 'transparent',
							color: '#aaa'
						} });
				} else {
					// Restore screen
					$.unblockUI();
				}
			},
			webrtcState: function(on) {
				Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
				$("#screencapture").parent().unblock();
				if(on) {
					//bootbox.alert("Your screen sharing session just started: pass the <b>" + room + "</b> session identifier to those who want to attend.");
					$("#roomidlabel").text("Room ID: "+room);
				} else {
					bootbox.alert("Your screen sharing session just stopped.", function() {
						janus.destroy();
						window.location.reload();
					});
				}
			},
			onmessage: function(msg, jsep) {
				Janus.debug(" ::: Got a message (publisher) :::");
				Janus.debug(msg);
				var event = msg["videoroom"];
				Janus.debug("Event: " + event);
				if(event != undefined && event != null) {
					if(event === "joined") {
						myid = msg["id"];
						Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
						// This is our session, publish our stream
						Janus.debug("Negotiating WebRTC stream for our screen (capture " + capture + ")");
						screentest.createOffer(
							{
								media: { video: capture, audioSend: true, videoRecv: false},	// Screen sharing Publishers are sendonly
								success: function(jsep) {
									Janus.debug("Got publisher SDP!");
									Janus.debug(jsep);
									var publish = { "request": "configure", "audio": true, "video": true };
									screentest.send({"message": publish, "jsep": jsep});
								},
								error: function(error) {
									Janus.error("WebRTC error:", error);
									bootbox.alert("WebRTC error... " + JSON.stringify(error));
								}
							});
					} else if(event === "event") {
						// Any feed to attach to?
						if(role === "listener" && msg["publishers"] !== undefined && msg["publishers"] !== null) {
							var list = msg["publishers"];
							Janus.debug("Got a list of available publishers/feeds:");
							Janus.debug(list);
							for(var f in list) {
								var id = list[f]["id"];
								var display = list[f]["display"];
								Janus.debug("  >> [" + id + "] " + display);
								newRemoteFeed(id, display)
							}
						} else if(msg["leaving"] !== undefined && msg["leaving"] !== null) {
							// One of the publishers has gone away?
							var leaving = msg["leaving"];
							Janus.log("Publisher left: " + leaving);
							if(role === "listener" && msg["leaving"] === source) {
								bootbox.alert("The screen sharing session is over, the publisher left", function() {
									window.location.reload();
								});
							}
						} else if(msg["error"] !== undefined && msg["error"] !== null) {
							bootbox.alert(msg["error"]);
						}
					}
				}
				if(jsep !== undefined && jsep !== null) {
					Janus.debug("Handling SDP as well...");
					Janus.debug(jsep);
					screentest.handleRemoteJsep({jsep: jsep});
				}
			},
			onlocalstream: function(stream) {
				//attach local feed to video player
				Janus.debug(" ::: Got a local stream :::");
				Janus.debug(stream);
				Janus.attachMediaStream($('#screenvideo').get(0), stream);
				if(screentest.webrtcStuff.pc.iceConnectionState !== "completed" &&
						screentest.webrtcStuff.pc.iceConnectionState !== "connected") {
					$("#screencapture").parent().block({
						message: '<b>Publishing...</b>',
						css: {
							border: 'none',
							backgroundColor: 'transparent',
							color: 'red'
						}
					});
				}
			},
			onremotestream: function(stream) {
				// The publisher stream is sendonly, we don't expect anything here
			},
			oncleanup: function() {
				Janus.log(" ::: Got a cleanup notification :::");
				$('#screencapture').empty();
				$("#screencapture").parent().unblock();
				$('#room').hide();
			}
		});
}

function webCamPublisherInit(){
	janus.attach(
		{
			plugin: "janus.plugin.videoroom",
			opaqueId: opaqueId,
			success: function(pluginHandle) {
				$('#details').remove();
				cameratest = pluginHandle;
				Janus.log("Plugin attached! (" + cameratest.getPlugin() + ", id=" + cameratest.getId() + ")");

				//webcam publisher register
				console.log("this is the room(webcam try connect): "+room);
				myusername = randomString(12);
				var register = { "request": "join", "room": room, "ptype": "publisher", "display": "webcam_publisher" };
				cameratest.send({"message": register});

				console.log("webcam share function below");
				$('#start').removeAttr('disabled').html("Stop Streaming")
					.click(function() {
						$(this).attr('disabled', true);
						janus.destroy();
					});
			},
			error: function(error) {
				Janus.error("  -- Error attaching plugin...", error);
				bootbox.alert("Error attaching plugin... " + error);
			},
			consentDialog: function(on) {
				Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
				if(on) {
					// Darken screen
					$.blockUI({
						message: '',
						css: {
							border: 'none',
							padding: '15px',
							backgroundColor: 'transparent',
							color: '#aaa'
						} });
				} else {
					// Restore screen
					$.unblockUI();
				}
			},
			webrtcState: function(on) {
				Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
				$("#screencapture").parent().unblock();
				if(on) {
					//bootbox.alert("Your screen sharing session just started: pass the <b>" + room + "</b> session identifier to those who want to attend.");
					$("#roomidlabel").text("Room ID: "+room);
				} else {
					bootbox.alert("Your screen sharing session just stopped.", function() {
						janus.destroy();
						window.location.reload();
					});
				}
			},
			onmessage: function(msg, jsep) {
				Janus.debug(" ::: Got a message (publisher) :::");
				Janus.debug(msg);
				var event = msg["videoroom"];
				Janus.debug("Event: " + event);
				if(event != undefined && event != null) {
					if(event === "joined") {
						myid = msg["id"];
						Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
						// This is our session, publish our stream
						Janus.debug("Negotiating WebRTC stream for our screen (capture " + capture + ")");
						cameratest.createOffer(
							{
								// Add data:true here if you want to publish datachannels as well
								media: { audioRecv: false, videoRecv: false, audioSend: true, videoSend: true },	// Publishers are sendonly
								// If you want to test simulcasting (Chrome and Firefox only), then
								// pass a ?simulcast=true when opening this demo page: it will turn
								// the following 'simulcast' property to pass to janus.js to true
								simulcast: false,
								simulcast2: false,
								success: function(jsep) {
									Janus.debug("Got publisher SDP!");
									Janus.debug(jsep);
									var publish = { "request": "configure", "audio": true, "video": true };
									// You can force a specific codec to use when publishing by using the
									// audiocodec and videocodec properties, for instance:
									// 		publish["audiocodec"] = "opus"
									// to force Opus as the audio codec to use, or:
									// 		publish["videocodec"] = "vp9"
									// to force VP9 as the videocodec to use. In both case, though, forcing
									// a codec will only work if: (1) the codec is actually in the SDP (and
									// so the browser supports it), and (2) the codec is in the list of
									// allowed codecs in a room. With respect to the point (2) above,
									// refer to the text in janus.plugin.videoroom.cfg for more details
									cameratest.send({"message": publish, "jsep": jsep});
								},
								error: function(error) {
									Janus.error("WebRTC error:", error);
									bootbox.alert("WebRTC error... " + JSON.stringify(error));
								}
							});
					} else if(event === "event") {
						// Any feed to attach to?
						if(role === "listener" && msg["publishers"] !== undefined && msg["publishers"] !== null) {
							var list = msg["publishers"];
							Janus.debug("Got a list of available publishers/feeds:");
							Janus.debug(list);
							for(var f in list) {
								var id = list[f]["id"];
								var display = list[f]["display"];
								Janus.debug("  >> [" + id + "] " + display);
								newRemoteFeed(id, display)
							}
						} else if(msg["leaving"] !== undefined && msg["leaving"] !== null) {
							// One of the publishers has gone away?
							var leaving = msg["leaving"];
							Janus.log("Publisher left: " + leaving);
							if(role === "listener" && msg["leaving"] === source) {
								bootbox.alert("The screen sharing session is over, the publisher left", function() {
									window.location.reload();
								});
							}
						} else if(msg["error"] !== undefined && msg["error"] !== null) {
							bootbox.alert(msg["error"]);
						}
					}
				}
				if(jsep !== undefined && jsep !== null) {
					Janus.debug("Handling SDP as well...");
					Janus.debug(jsep);
					cameratest.handleRemoteJsep({jsep: jsep});
				}
			},
			onlocalstream: function(stream) {
				//attach local feed to video player
				Janus.debug(" ::: Got a local stream :::");
				Janus.debug(stream);
				Janus.attachMediaStream($('#cameravideo').get(0), stream);
				if(cameratest.webrtcStuff.pc.iceConnectionState !== "completed" &&
					cameratest.webrtcStuff.pc.iceConnectionState !== "connected") {
					$("#screencapture").parent().block({
						message: '<b>Publishing...</b>',
						css: {
							border: 'none',
							backgroundColor: 'transparent',
							color: 'red'
						}
					});
				}
			},
			onremotestream: function(stream) {
				// The publisher stream is sendonly, we don't expect anything here
			},
			oncleanup: function() {
				Janus.log(" ::: Got a cleanup notification :::");
				$('#screencapture').empty();
				$("#screencapture").parent().unblock();
				$('#room').hide();
			}
		});
}


//$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$

function initDevices(devices) {
	//$('#choose-device').click(restartCapture);
	var audio = $('#audio-device').val();
	var video = $('#video-device').val();
	$('#audio-device, #video-device').find('option').remove();
	console.log(devices);
	devices.forEach(function(device) {
		var label = device.label;
		console.log("DEVICE LABEL : "+device.label);
		if(label === null || label === undefined || label === "")
			label = device.deviceId;
			console.log("DEVICE LABEL not found DevID : "+device.deviceid);
		var option = $('<option value="' + device.deviceId + '">' + label + '</option>');
		if(device.kind === 'audioinput') {
			$('#audio-device').append(option);
		} else if(device.kind === 'videoinput') {
			$('#video-device').append(option);
		}
	});

	$('#audio-device').val(audio);
	$('#video-device').val(video);

	$('#change-devices').click(function() {
		// A different device has been selected: hangup the session, and set it up again
		if(firstTime) {
			firstTime = false;
			restartCapture();
			return;
		}
		restartCapture();
	});
}

function restartCapture() {
	// Negotiate WebRTC
	var body = { "audio": true, "video": true };
	Janus.debug("Sending message (" + JSON.stringify(body) + ")");
	cameratest.send({"message": body});
	Janus.debug("Trying a createOffer too (audio/video sendrecv)");
	var replaceAudio = $('#audio-device').val() !== audioDeviceId;
	audioDeviceId = $('#audio-device').val();
	var replaceVideo = $('#video-device').val() !== videoDeviceId;
	videoDeviceId = $('#video-device').val();
	cameratest.createOffer(
		{
			// We provide a specific device ID for both audio and video
			media: {
				audio: {
					deviceId: {
						exact: audioDeviceId
					}
				},
				replaceAudio: replaceAudio,	// This is only needed in case of a renegotiation
				video: {
					deviceId: {
						exact: videoDeviceId
					}
				},
				replaceVideo: replaceVideo,	// This is only needed in case of a renegotiation
				//data: true	// Let's negotiate data channels as well
			},
			// If you want to test simulcasting (Chrome and Firefox only), then
			// pass a ?simulcast=true when opening this demo page: it will turn
			// the following 'simulcast' property to pass to janus.js to true
			simulcast: doSimulcast,
			success: function(jsep) {
				Janus.debug("Got SDP!");
				Janus.debug(jsep);
				cameratest.send({"message": body, "jsep": jsep});
			},
			error: function(error) {
				Janus.error("WebRTC error:", error);
				bootbox.alert("WebRTC error... " + JSON.stringify(error));
			}
		});
}
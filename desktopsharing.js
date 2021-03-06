/**
 * Indicates that desktop stream is currently in use(for toggle purpose).
 * @type {boolean}
 */
var isUsingScreenStream = false;
/**
 * Indicates that switch stream operation is in progress and prevent from triggering new events.
 * @type {boolean}
 */
var switchInProgress = false;

/**
 * Method used to get screen sharing stream.
 *
 * @type {function(stream_callback, failure_callback}
 */
var obtainDesktopStream = null;

/**
 * @returns {boolean} <tt>true</tt> if desktop sharing feature is available and enabled.
 */
function isDesktopSharingEnabled() {
    if(obtainDesktopStream === obtainScreenFromExtension) {
        // Parse chrome version
        var userAgent = navigator.userAgent.toLowerCase();
        // We can assume that user agent is chrome, because it's enforced when 'ext' streaming method is set
        var ver = parseInt(userAgent.match(/chrome\/(\d+)\./)[1], 10);
        console.log("Chrome version" + userAgent, ver);
        return ver >= 35;
    } else {
        return obtainDesktopStream === obtainWebRTCScreen;
    }
}

/**
 * Call this method to toggle desktop sharing feature.
 * @param method pass "ext" to use chrome extension for desktop capture(chrome extension required),
 *        pass "webrtc" to use WebRTC "screen" desktop source('chrome://flags/#enable-usermedia-screen-capture'
 *        must be enabled), pass any other string or nothing in order to disable this feature completely.
 */
function setDesktopSharing(method) {
    if(method == "ext") {
        if(RTC.browser === 'chrome') {
            obtainDesktopStream = obtainScreenFromExtension;
            console.info("Using Chrome extension for desktop sharing");
        } else {
            console.error("Chrome is required to use extension method");
            obtainDesktopStream = null;
        }
    } else if(method == "webrtc") {
        obtainDesktopStream = obtainWebRTCScreen;
        console.info("Using WebRTC for desktop sharing");
    } else {
        obtainDesktopStream = null;
        console.info("Desktop sharing disabled");
    }
    showDesktopSharingButton();
}

function showDesktopSharingButton() {
    if(isDesktopSharingEnabled()) {
        $('#desktopsharing').css( {display:"inline"} );
    } else {
        $('#desktopsharing').css( {display:"none"} );
    }
}

/*
 * Toggles screen sharing.
 */
function toggleScreenSharing() {
    if (switchInProgress || !obtainDesktopStream) {
        console.warn("Switch in progress or no method defined");
        return;
    }
    switchInProgress = true;

    // Only the focus is able to set a shared key.
    if(!isUsingScreenStream)
    {
        obtainDesktopStream(
            function(stream) {
                // We now use screen stream
                isUsingScreenStream = true;
                // Hook 'ended' event to restore camera when screen stream stops
                stream.addEventListener('ended',
                    function(e) {
                        if(!switchInProgress && isUsingScreenStream) {
                            toggleScreenSharing();
                        }
                    }
                );
                newStreamCreated(stream);
            },
            getSwitchStreamFailed );
    } else {
        // Disable screen stream
        getUserMediaWithConstraints(
            ['video'],
            function(stream) {
                // We are now using camera stream
                isUsingScreenStream = false;
                newStreamCreated(stream);
            },
            getSwitchStreamFailed, config.resolution || '360'
        );
    }
}

function getSwitchStreamFailed(error) {
    console.error("Failed to obtain the stream to switch to", error);
    switchInProgress = false;
}

function newStreamCreated(stream) {

    var oldStream = connection.jingle.localVideo;

    change_local_video(stream, !isUsingScreenStream);

    var conferenceHandler = getConferenceHandler();
    if(conferenceHandler) {
        // FIXME: will block switchInProgress on true value in case of exception
        conferenceHandler.switchStreams(stream, oldStream, streamSwitchDone);
    } else {
        // We are done immediately
        console.error("No conference handler");
        streamSwitchDone();
    }
}

function streamSwitchDone() {
    //window.setTimeout(
    //    function() {
            switchInProgress = false;
    //    }, 100
    //);
}

/**
 * Method obtains desktop stream from WebRTC 'screen' source.
 * Flag 'chrome://flags/#enable-usermedia-screen-capture' must be enabled.
 */
function obtainWebRTCScreen(streamCallback, failCallback) {
    getUserMediaWithConstraints(
        ['screen'],
        streamCallback,
        failCallback
    );
}

/**
 * Asks Chrome extension to call chooseDesktopMedia and gets chrome 'desktop' stream for returned stream token.
 */
function obtainScreenFromExtension(streamCallback, failCallback) {
    checkExtInstalled(
        function(isInstalled) {
            if(isInstalled) {
                doGetStreamFromExtension(streamCallback, failCallback);
            } else {
                chrome.webstore.install(
                    "https://chrome.google.com/webstore/detail/" + config.chromeExtensionId,
                    function(arg) {
                        console.log("Extension installed successfully", arg);
                        // We need to reload the page in order to get the access to chrome.runtime
                        window.location.reload(false);
                    },
                    function(arg) {
                        console.log("Failed to install the extension", arg);
                        failCallback(arg);
                    }
                );
            }
        }
    );
}

function checkExtInstalled(isInstalledCallback) {
    if(!chrome.runtime) {
        // No API, so no extension for sure
        isInstalledCallback(false);
        return false;
    }
    chrome.runtime.sendMessage(
        config.chromeExtensionId,
        { getVersion: true },
        function(response){
            if(!response || !response.version) {
                // Communication failure - assume that no endpoint exists
                console.warn("Extension not installed?: "+chrome.runtime.lastError);
                isInstalledCallback(false);
            } else {
                // Check installed extension version
                var extVersion = response.version;
                console.log('Extension version is: '+extVersion);
                var updateRequired = extVersion < config.minChromeExtVersion;
                if(updateRequired) {
                    alert(
                        'Jitsi Desktop Streamer requires update. ' +
                        'Changes will take effect after next Chrome restart.' );
                }
                isInstalledCallback(!updateRequired);
            }
        }
    );
}

function doGetStreamFromExtension(streamCallback, failCallback) {
    // Sends 'getStream' msg to the extension. Extension id must be defined in the config.
    chrome.runtime.sendMessage(
        config.chromeExtensionId,
        { getStream: true},
        function(response) {
            if(!response) {
                failCallback(chrome.runtime.lastError);
                return;
            }
            console.log("Response from extension: "+response);
            if(response.streamId) {
                getUserMediaWithConstraints(
                    ['desktop'],
                    function(stream) {
                        streamCallback(stream);
                    },
                    failCallback,
                    null, null, null,
                    response.streamId);
            } else {
                failCallback("Extension failed to get the stream");
            }
        }
    );
}

const $ = document.querySelector.bind(document);

const HEARTBEAT_PERIOD = 1000; // might be increased in the future

var colorInterval;
var colorWaitInterval;
var flashTimeout;
var colorPeriod = 0;
var nextTick = 0;

var isVisible = true;
var currentColor = [0,0,0];

var isSlave = false;
var peer;
var conns = {};
var sendToSlavesQueue = {};

function randomizeColor() {
    const r = genColorComponent();
    const g = genColorComponent();
    const b = genColorComponent();

    setColor(r,g,b);
    updateSetColor(r,g,b);
    sendToSlaves("color", [r,g,b]);
}

function genColorComponent() {
    return Math.floor(Math.random() * 256);
}

function setColor(r,g,b) {
    nextTick = (new Date()).getTime() + colorPeriod;
    $("body").style.backgroundColor = `rgb(${r},${g},${b})`;
    currentColor = [r,g,b];
}

function updateSetColor(r,g,b) {
    const colorString = `rgb(${r},${g},${b})`;
    $("#set-color").innerText = colorString;
    document.title = colorString;
}

function updateCurrentColor() {
    const colorString = window.getComputedStyle($("body"), null).getPropertyValue("background-color");
    $("#current-color").innerText = colorString;
}

function setColorPeriod(periodMS) {
    periodMS = Math.min(Math.max(periodMS, 100), 5000); // set constraints on period

    $("body").style.transitionDuration = `${periodMS}ms`;
    $("#interval").innerText = periodMS;

    if (colorInterval) {
        clearInterval(colorInterval);
        colorInterval = undefined;
    }
    if (colorWaitInterval) clearTimeout(colorWaitInterval);
    colorPeriod = periodMS;
    
    const thisTick = (new Date()).getTime();
    colorWaitInterval = setTimeout(() => { // wait until this interval would have ended
        
        sendToSlaves("interval", colorPeriod);
        if (!isSlave) {
            randomizeColor(); // initial, fast call
            colorInterval = setInterval(randomizeColor, periodMS); // repeating, slow call
        }
        colorWaitInterval = undefined;
    }, nextTick - thisTick);
    
    if (flashTimeout) clearTimeout(flashTimeout);

    $("#interval").classList.remove("slow-animations");
    $("#interval").classList.add("opaque");
    $("#interval").offsetHeight; // trigger reflow
    $("#interval").classList.add("slow-animations");
    $("#interval").classList.remove("opaque");
}

function toggleHide() {
    $("body").classList.toggle("only-colors");
    isVisible = !$("body").classList.contains("only-colors");
    sendToSlaves("visibility", isVisible);
}

$("body").addEventListener("keydown", (e) => {
    const step = e.ctrlKey ? 100 : 10;

    switch (e.key) {
        case "ArrowUp": // incrase period
            setColorPeriod(colorPeriod + step);
            break;
        case "ArrowDown": // decrease period
            setColorPeriod(colorPeriod - step);
            break;
    }
});

$("body").addEventListener("click", toggleHide);

function generatePeer() {
    const peerId = window.location.search.substring(1);
    if (peerId) generateSlave(peerId); // connect to this id
    else generateMaster();             // create new id to connect to
}

function generateMaster() {
    isSlave = false;
    setColorPeriod(1000); // default time, only slaves generate colors

    const peerId = createIDString(4);
    $("#id").innerText = peerId;

    peer = new Peer("rcolor-glitch_" + peerId); // identify app as rcolor, so as not to interfere with any other apps using this method
    peer.on("open", id => {
        $("#id").classList.remove("hiddens"); // show id once initialized with peerJS server
    });

    peer.on("connection", conn => {
        conns[conn.connectionId] = {
            conn: conn,
            hb: (new Date).getTime()
        };
        
        conn.on("data", data => {
            let updateHB = false;
            if ("hb" in data) updateHB = true;
            if ("init" in data) {
                queueSendToSlaves("interval", colorPeriod);
                queueSendToSlaves("visibility", isVisible);
                sendToSlaves("color", currentColor, conn.connectionId);
                updateHB = true;
            }
            if ("visibility" in data && data.visibility != isVisible) {
                queueSendToSlaves("from", conn.connectionId);
                toggleHide();
                updateHB = true;
            }
            if ("interval" in data && data.interval != colorPeriod) {
                queueSendToSlaves("from", conn.connectionId);
                setColorPeriod(data.interval);
                updateHB = true;
            }

            if (updateHB) refreshHeartbeat(conn.connectionId);
        });
    });

    setInterval(trimHeartbeatless, 1000); // check this once every second // might want to decrease frequency of checking
}

// use this when you KNOW the next message will be send almost instantly
function queueSendToSlaves(key,value) {
    sendToSlavesQueue[key] = value;
}

function sendToSlaves(key, value, oneSlaveId=null) {
    sendToSlavesQueue[key] = value;

    if (oneSlaveId) conns[oneSlaveId].conn.send(sendToSlavesQueue); 
    else for (let i in conns) { conns[i].conn.send(sendToSlavesQueue); }
    
    sendToSlavesQueue = {}; // reset queue
}

function generateSlave(peerId) {
    isSlave = true;
    peer = new Peer();
    peer.on("open", () => {
        $("#id").innerText = peerId;
        const conn = peer.connect("rcolor-glitch_" + peerId);
        conn.on("open", () => {
            conns[conn] = {
                "hb": (new Date()).getTime(),
                conn: conn
            };
            conn.on("data", data => {
                if ("from" in data && data.from == conn.connectionId) { // original mesage from this peer, ignore
                    return;
                }

                if ("color" in data) {
                    const [r,g,b] = data.color;
                    setColor(r,g,b);
                    updateSetColor(r,g,b);
                }
                if ("interval" in data) {
                    setColorPeriod(data.interval);
                }
                if ("visibility" in data && data.visibility != isVisible) { toggleHide(); }
            });

            // heartbeat
            setInterval(() => {
                conn.send({ "hb": true });
            }, HEARTBEAT_PERIOD);

            conn.send({ "init": true }); // send that connection has been made // might not be necessary
        });
    });
}

function refreshHeartbeat(connId) {
    conns[connId].hb = (new Date).getTime();
}

function trimHeartbeatless() {
    const now = (new Date()).getTime();
    for (let i in conns) {
        if (now > conns[i].hb + 10*HEARTBEAT_PERIOD) { // missed 10 consecutive heartbeats
            conns[i].conn.send({ "disconnected": true });
            // console.log("death")
            delete conns[i];
        }            
    }
}

const validChars = "ACDEFGHIJKMNPQRTUVWXYZ3467";
function createIDString(length=4) {
    let str = "";
    for (let i = 0; i < length; i++) {
        str += validChars[Math.floor(Math.random() * validChars.length)];
    }
    return str;
}

setInterval(() => {
    updateCurrentColor();
}, 10);

generatePeer();
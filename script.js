import { Server } from "./virtual-server-src/server.js";
import { Client } from "./virtual-server-src/client.js";

const $ = document.querySelector.bind(document);

const HEARTBEAT_PERIOD = 1000; // might be increased in the future

var colorInterval;
var colorWaitInterval;
var flashTimeout;
var colorPeriod = 0;
var nextTick = 0;

var isVisible = true;
var currentColor = [0,0,0];
var isPaused = false;

var isSlave = false;
var peer;

var peerIsReady = false;

var mode = 0;
var modeStrs = ["rgb(&9r,&9g,&9b)", "&9r &9g &9b", "#&xr&xb&xg"];

function randomizeColor() {
    const r = genColorComponent();
    const g = genColorComponent();
    const b = genColorComponent();

    setColor(r,g,b);
    updateSetColor();
    peer.getVariable("color").set([r,g,b]);
}

function unRandomizeColor(r,g,b, doSend=true) {
    setColor(r,g,b);
    updateSetColor();
    if (doSend) peer.getVariable("color").set([r,g,b]);
}

function genColorComponent() {
    return Math.floor(Math.random() * 256);
}

function setColor(r,g,b) {
    nextTick = (new Date()).getTime() + colorPeriod;
    $("body").style.backgroundColor = `rgb(${r},${g},${b})`;
    currentColor = [r,g,b];

    if (isPaused) {
        $("#custom-color > #r").value = r;
        $("#custom-color > #g").value = g;
        $("#custom-color > #b").value = b;
    }
}

function updateSetColor() {
    const [r,g,b] = currentColor;
    
    const colorString = genColorStr(r,g,b);
    $("#set-color").innerText = colorString;
    document.title = colorString;
}

function genColorStr(r,g,b) {
    const [xr,xg,xb] = [lpad(r.toString(16)), lpad(g.toString(16)), lpad(b.toString(16))];
    const colorString = modeStrs[mode]
    .replace("&9r", r)
    .replace("&xr", xr)
    .replace("&9g", g)
    .replace("&xg", xg)
    .replace("&9b", b)
    .replace("&xb", xb);

    return colorString;
}

function lpad(str) {
    while (str.length < 2) {
        str = "0" + str;
    }
    return str;
}

function updateCurrentColor() {
    const [r,g,b] = getCurrentColor();
    $("#current-color").innerText = genColorStr(parseInt(r,10),parseInt(g,10),parseInt(b,10));
}

function getCurrentColor() {
    const rawColor = window.getComputedStyle($("body"), null).getPropertyValue("background-color");
    return rawColor.match(/\d+/g);
}

function setColorPeriod(periodMS, doSend=true) {
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
        
        if (doSend) peer.getVariable("interval").set(colorPeriod);
        if (!isSlave) {
            randomizeColor(); // initial, fast call
            if (colorInterval) {
                clearInterval(colorInterval);
                colorInterval = undefined;
            }
            colorInterval = setInterval(randomizeColor, periodMS); // repeating, slow call
        }
        colorWaitInterval = undefined;
    }, Math.max(nextTick - thisTick,10));
    
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
    peer.getVariable("visibility").set(isVisible);
}

function togglePause(doSend=true) {
    isPaused = !isPaused;
    if (doSend) peer.getVariable("paused").set(isPaused);
    if (isPaused) {
        if (colorInterval) clearInterval(colorInterval); 
        if (colorWaitInterval) clearTimeout(colorWaitInterval);
        colorInterval = undefined;

        const [r,g,b] = getCurrentColor();
        unRandomizeColor(r,g,b, doSend);
        if (doSend) peer.getVariable("color").set([r,g,b]);
        $("#custom-color > #r").value = r;
        $("#custom-color > #g").value = g;
        $("#custom-color > #b").value = b;

        nextTick = 0;

        if (!isVisible) toggleHide();

        $("#color-holder").classList.add("customs");        
    }
    else {
        if (!isSlave) setColorPeriod(colorPeriod, doSend);
        $("#color-holder").classList.remove("customs");
    }
}

function handleInput(index, val) {
    let num = Math.min(Math.max(parseInt(val,10),0),255);
    currentColor[index] = num;
    unRandomizeColor(currentColor[0], currentColor[1], currentColor[2], true);
}

$("#custom-color > #r").addEventListener("click", (e) => { e.stopPropagation(); });
$("#custom-color > #g").addEventListener("click", (e) => { e.stopPropagation(); });
$("#custom-color > #b").addEventListener("click", (e) => { e.stopPropagation(); });

$("#custom-color > #r").addEventListener("input", function () { handleInput(0, this.value); });
$("#custom-color > #g").addEventListener("input", function () { handleInput(1, this.value); });
$("#custom-color > #b").addEventListener("input", function () { handleInput(2, this.value); });

$("body").addEventListener("keydown", (e) => {
    const step = e.ctrlKey ? 100 : 10;

    switch (e.key) {
        case "ArrowUp": // incrase period
            setColorPeriod(colorPeriod + step);
            break;
        case "ArrowDown": // decrease period
            setColorPeriod(colorPeriod - step);
            break;
        case " ": // pause/play
            togglePause(true);
            break;
    }
});

$("body").addEventListener("click", toggleHide);

function changeMode(step, doSend=true) {
    mode += step;
    if (mode < 0) mode = modeStrs.length-1;
    if (mode >= modeStrs.length) mode = 0;

    updateSetColor();
    if (doSend) peer.getVariable("mode").set(mode);
}

$("#next-type").addEventListener("click", function(e) {
    e.stopPropagation();
    changeMode(1,true);
});
$("#last-type").addEventListener("click", function(e) {
    e.stopPropagation();
    changeMode(-1,true);
});

function generatePeer() {
    const peerId = window.location.search.substring(1);
    if (peerId) generateSlave(peerId.toUpperCase()); // connect to this id
    else generateMaster();             // create new id to connect to

    peer.on("init", () => {
        peerIsReady = true;
    })

    peer.on("variable", (changed) => {
        if (changed.get() === null) return;
        switch (changed.name) {
            case "visibility":
                if (isVisible != changed.get()) toggleHide(false);
                break;
            case "color": {
                const [r,g,b] = changed.get();
                if (r == currentColor[0] && g == currentColor[1] && b == currentColor[2]) return;
                unRandomizeColor(r,g,b, false);
                break;
            }
            case "interval":
                if (changed.get() == colorPeriod) return;
                setColorPeriod(changed.get(), false);
                break;
            case "paused":
                if (isPaused != changed.get()) togglePause(false);
                break;
            case "mode":
                changeMode(changed.get() - mode, false);
                break;
            default:
                console.log(changed.name)
        }
    })
}

function generateMaster() {
    isSlave = false;
    setColorPeriod(1000); // default time, only slaves generate colors

    const peerId = createIDString(4);
    $("#id").innerText = peerId;

    peer = new Server({
        peerHost: "rcolor",
        peerId: peerId
    });
}

function generateSlave(peerId) {
    isSlave = true;
    peer = new Client({
        peerHost: "rcolor",
        peerId: peerId
    });
}

const validChars = "ACDEFGHJKMNPQRTUVWXYZ3467";
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

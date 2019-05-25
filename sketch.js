function setup(){
    setVersion(TITLE + " v",VERSION_NUMBER);
    document.title = TITLE;

    createCanvas(WIDTH,HEIGHT);
    defineColors(); // Set the values of COLORS since color() can't be used before setup()
    background(COLORS.bg);
    paused = false;
    simSettings = new Settings();
    basin = undefined;
    newBasinSettings = {};
    storageQuotaExhausted = false;

    textInput = document.createElement("input");
    textInput.type = "text";
    document.body.appendChild(textInput);
    textInput.style.position = "absolute";
    textInput.style.left = "-500px";
    textInput.onblur = ()=>{UI.focusedInput = undefined;};

    buffers = new Map();
    scaler = 1;

    tracks = createBuffer();
    tracks.strokeWeight(2);
    stormIcons = createBuffer();
    stormIcons.strokeWeight(3);
    forecastTracks = createBuffer();
    forecastTracks.strokeWeight(3);
    forecastTracks.stroke(240,240,0);
    landBuffer = createBuffer(WIDTH,HEIGHT,true);
    landBuffer.noStroke();
    landShader = createBuffer(WIDTH,HEIGHT,true);
    landShader.noStroke();
    coastLine = createBuffer(WIDTH,HEIGHT,true);
    coastLine.fill(0);
    coastLine.noStroke();
    envLayer = createBuffer(WIDTH,HEIGHT,true);
    envLayer.colorMode(HSB);
    envLayer.strokeWeight(2);
    envLayer.noStroke();
    snow = [];
    for(let i=0;i<MAX_SNOW_LAYERS;i++){
        snow[i] = createBuffer(WIDTH,HEIGHT,true);
        snow[i].noStroke();
        snow[i].fill(COLORS.snow);
    }

    simSpeed = 0; // The exponent for the simulation speed (0 is full-speed, 1 is half-speed, etc.)
    simSpeedFrameCounter = 0; // Counts frames of draw() while unpaused; modulo 2^simSpeed to advance sim when 0
    keyRepeatFrameCounter = 0;

    renameOldBasinSaveKeys();
    UI.init();
}

function draw(){
    try{
        scale(scaler);
        background(COLORS.bg);
        if(basin){
            if(finisher){
                let t = finisher.next();
                if(t.done){
                    finisher = undefined;
                    return;
                }
                push();
                textSize(48);
                textAlign(CENTER,CENTER);
                text(t.value,WIDTH/2,HEIGHT/2);
                pop();
                return;
            }
            stormIcons.clear();
            if(!paused){
                simSpeedFrameCounter++;
                simSpeedFrameCounter%=pow(2,simSpeed);
                if(simSpeedFrameCounter===0) advanceSim();
            }
            keyRepeatFrameCounter++;
            if(keyIsPressed && (keyRepeatFrameCounter>=KEY_REPEAT_COOLDOWN || keyRepeatFrameCounter===0) && keyRepeatFrameCounter%KEY_REPEATER===0){
                if(paused && primaryWrapper.showing){
                    let oldS = basin.getSeason(viewTick);
                    if(keyCode===LEFT_ARROW && viewTick>=ADVISORY_TICKS){
                        viewTick = ceil(viewTick/ADVISORY_TICKS-1)*ADVISORY_TICKS;
                        let newS = basin.getSeason(viewTick);
                        refreshTracks(newS!==oldS);
                        Env.displayLayer();
                    }else if(keyCode===RIGHT_ARROW){
                        if(viewTick<basin.tick-ADVISORY_TICKS) viewTick = floor(viewTick/ADVISORY_TICKS+1)*ADVISORY_TICKS;
                        else viewTick = basin.tick;
                        let newS = basin.getSeason(viewTick);
                        refreshTracks(newS!==oldS);
                        Env.displayLayer();
                    }
                }
            }
        }
    
        UI.updateMouseOver();
        UI.renderAll();
    }catch(err){            // BSOD
        resetMatrix();
        colorMode(RGB);
        background(0,0,200);
        fill(255);
        textSize(24);
        textAlign(LEFT,TOP);
        text("Crash!",width/16,height/8);
        textSize(15);
        text(err.stack,width/16,height/4);
        console.error(err);
        noLoop();
    }
}

function init(load){
    if(load!==undefined){
        basin = new Basin(load);
        paused = true;
    }else{
        let opts = {};
        if(newBasinSettings.hem===1) opts.hem = false;
        else if(newBasinSettings.hem===2) opts.hem = true;
        else opts.hem = random()<0.5;
        opts.year = opts.hem ? SHEM_DEFAULT_YEAR : NHEM_DEFAULT_YEAR;
        if(newBasinSettings.year!==undefined) opts.year = newBasinSettings.year;
        opts.seed = newBasinSettings.seed;
        opts.hyper = newBasinSettings.hyper;
        opts.names = newBasinSettings.names;
        opts.hurrTerm = newBasinSettings.hurrTerm;
        opts.mapType = newBasinSettings.mapType;
        opts.godMode = newBasinSettings.godMode;
        basin = new Basin(false,opts);
        newBasinSettings = {};
        paused = false;
    }

    viewTick = basin.tick;
    selectedStorm = undefined;
    noiseSeed(basin.seed);
    Environment.init();
    if(!basin.fetchSeason(-1,true)) basin.seasons[basin.getSeason(-1)] = new Season();
    if(basin.tick===0) Env.record();
    land = new Land();
    refreshTracks(true);
    primaryWrapper.show();
    finisher = finishInit();
}

function* finishInit(){
    yield* land.init();
}

function advanceSim(){
    let vp = basin.viewingPresent();
    basin.tick++;
    let os = basin.getSeason(viewTick);
    viewTick = basin.tick;
    let curSeason = basin.getSeason(-1);
    if(!basin.fetchSeason(curSeason)){
        let e = new Season();
        for(let s of basin.activeSystems) e.addSystem(new StormRef(s.fetchStorm()));
        basin.seasons[curSeason] = e;
    }
    if(!vp || curSeason!==os) refreshTracks(curSeason!==os);
    Env.wobble();    // random change in environment for future forecast realism
    for(let i=0;i<basin.activeSystems.length;i++){
        for(let j=i+1;j<basin.activeSystems.length;j++){
            basin.activeSystems[i].interact(basin.activeSystems[j],true);
        }
        basin.activeSystems[i].update();
    }
    if(random()<0.015*sq((seasonalSine(basin.tick)+1)/2)) basin.spawn(false);    // tropical waves
    if(random()<0.01-0.002*seasonalSine(basin.tick)) basin.spawn(true);    // extratropical cyclones
    let stormKilled = false;
    for(let i=basin.activeSystems.length-1;i>=0;i--){
        if(!basin.activeSystems[i].fetchStorm().current){
            basin.activeSystems.splice(i,1);
            stormKilled = true;
        }
    }
    if(stormKilled) refreshTracks();
    if(basin.tick%ADVISORY_TICKS==0){
        Env.displayLayer();
        Env.record();
    }
    let curTime = basin.tickMoment();
    if(simSettings.doAutosave && !storageQuotaExhausted && (curTime.date()===1 || curTime.date()===15) && curTime.hour()===0) basin.save();
}

class Settings{
    constructor(){
        const k = LOCALSTORAGE_KEY_PREFIX + LOCALSTORAGE_KEY_SETTINGS;
        const order = Settings.order();
        const defaults = Settings.defaults();
        let v = localStorage.getItem(k);
        if(v) v = decodeB36StringArray(v);
        else v = [];
        for(let i=order.length-1;i>=0;i--){
            if(v.length>0) this[order[i]] = v.pop();
            else this[order[i]] = defaults[i];
        }
        let sf = (k)=>{
            return (v,v2)=>{
                this.set(k,v,v2);
            };
        };
        for(let i=0;i<order.length;i++){
            let n = "set" + order[i].charAt(0).toUpperCase() + order[i].slice(1);
            this[n] = sf(order[i]);
        }
    }

    static order(){
        return ["snowLayers","useShader","trackMode","showStrength","doAutosave"];    // add new settings to the beginning of this array
    }

    static defaults(){
        return [2,false,0,false,true];  // add new defaults to the beginning of this array
    }

    save(){
        const k = LOCALSTORAGE_KEY_PREFIX + LOCALSTORAGE_KEY_SETTINGS;
        const order = Settings.order();
        let v = [];
        for(let i=0;i<order.length;i++){
            v.push(this[order[i]]);
        }
        v = encodeB36StringArray(v);
        modifyLocalStorage(()=>{
            localStorage.setItem(k,v);
        },(e)=>{
            console.error(e);
            alert("Cannot save settings due to saving quota");
        });
    }

    set(k,v,v2){
        if(v==="toggle") this[k] = !this[k];
        else if(v==="incmod"){
            this[k]++;
            this[k] %= v2;
        }else this[k] = v;
        this.save();
    }

    get(k){         // accessing the property directly also works (only for getting)
        return this[k];
    }
}
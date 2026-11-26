/* BTC Graph — shared runtime: nav, theme, formatting, live price feed, network API. */
(function(){
  /* Site map. Top-level entries are either a page or a group of pages; the order here is
     also the order of the "previous / next chart" links at the foot of every page. */
  var NAV = [
    {href:"index.html", label:"Dashboard", desc:"Live price, market signals and every chart"},
    {label:"Cycles & trend", items:[
      {href:"cycles.html",    label:"Halving cycles",    desc:"Every four-year cycle, overlaid"},
      {href:"power-law.html", label:"Power law",         desc:"The long-run trend line and its bands"},
      {href:"valuation.html", label:"Cheap or expensive",desc:"Price against its 200-day average"}
    ]},
    {label:"Returns", items:[
      {href:"heatmap.html",   label:"Monthly returns",   desc:"Every month as a colored cell"},
      {href:"holding.html",   label:"Holding periods",   desc:"How often patience has paid"},
      {href:"dca.html",       label:"DCA simulator",     desc:"Buying a little, on a schedule"}
    ]},
    {label:"Risk", items:[
      {href:"drawdown.html",  label:"Drawdowns",         desc:"How far below the high, and for how long"},
      {href:"volatility.html",label:"Volatility",        desc:"How wild the ride is, and how it's calming"}
    ]},
    {href:"network.html", label:"Network & supply", desc:"Halving countdown, supply, hashrate, blocks"}
  ];
  var PAGES = [];
  NAV.forEach(function(g){ if(g.items) g.items.forEach(function(p){ PAGES.push(p); }); else PAGES.push(g); });
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var D = window.BTC_DATA;

  /* ---------- storage (per-viewer conveniences only) ---------- */
  function store(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v); }catch(e){ return null; } }

  /* ---------- theme ---------- */
  var saved = store("btcgraph.theme");
  if(saved==="light"||saved==="dark") document.documentElement.setAttribute("data-theme",saved);
  function isDark(){
    var t=document.documentElement.getAttribute("data-theme");
    if(t) return t==="dark";
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /* ---------- formatting ---------- */
  function fmtMonth(ym){ var p=ym.split("-"); return MONTHS[parseInt(p[1],10)-1]+" "+p[0]; }
  function fmtUSD(v,dp){ return "$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:dp||0,maximumFractionDigits:dp||0}); }
  function fmtCompact(v){
    var a=Math.abs(v), s;
    if(a>=1e12) s=(v/1e12).toFixed(1)+"T";
    else if(a>=1e9) s=(v/1e9).toFixed(1)+"B";
    else if(a>=1e6) s=(v/1e6).toFixed(1)+"M";
    else if(a>=1e3) s=(v/1e3).toFixed(a>=1e4?0:1)+"k";
    else s=String(Math.round(v));
    return s.replace(/\.0(?=[kMBT]$)/,"");   /* "1.0k" → "1k" */
  }
  function fmtPct(v,dp){ return (v>0?"+":"")+v.toFixed(dp==null?1:dp)+"%"; }
  function fmtDate(d){ return MONTHS[d.getMonth()]+" "+d.getDate()+", "+d.getFullYear(); }
  /* a UTC day (ms) as "Nov 14, 2026"; daily closes are keyed by their UTC day */
  function fmtDay(t){ var d=new Date(t); return MONTHS[d.getUTCMonth()]+" "+d.getUTCDate()+", "+d.getUTCFullYear(); }
  function fmtMult(v){ return v>=100?Math.round(v).toLocaleString("en-US")+"×":v>=10?v.toFixed(1)+"×":v.toFixed(2)+"×"; }
  function ym(d){ return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0"); }

  /* ---------- live price ---------- */
  /* Until the live feed connects, start from whichever is newer: the data file's snapshot
     (taken at the daily update) or the last live price this browser saw. The html element
     carries .px-wait meanwhile so the price can be shown as provisional. */
  var listeners=[], state={price:D.latest.usd, open24:null, live:false, cached:false,
    src:"snapshot "+D.latest.date, note:"Snapshot · "+D.latest.date};
  (function(){
    var snapT=Date.parse(D.latest.date+"T00:15:00Z"), c=null;
    try{ c=JSON.parse(store("btcgraph.lastPrice")||"null"); }catch(e){}
    if(c && c.p>0 && c.t>snapT && Date.now()-c.t<7*864e5){
      state.price=c.p; state.open24=c.o||null; state.cached=true;
      var d=new Date(c.t);
      state.note="Last seen · "+(Date.now()-c.t<864e5 ? d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})
        : d.toLocaleDateString("en-US",{month:"short",day:"numeric"}));
    }
  })();
  var root=document.documentElement;
  root.classList.add("px-wait");
  setTimeout(function(){ root.classList.remove("px-wait"); },5000);  /* feed unreachable: stop hinting */
  function emit(){ listeners.forEach(function(fn){ try{ fn(state); }catch(e){ console.error(e); } }); }
  function onPrice(fn){ listeners.push(fn); fn(state); }
  var lastEmit=0, pending=null, lastSave=0;
  function setPrice(p,open24,src){
    var first=!state.live;
    state.price=p; if(open24) state.open24=open24; state.live=true; state.cached=false; state.src=src; state.note=src;
    if(first) root.classList.remove("px-wait");
    if(Date.now()-lastSave>5000){ lastSave=Date.now(); store("btcgraph.lastPrice",JSON.stringify({p:p,o:state.open24,t:lastSave})); }
    if(first){ lastEmit=Date.now(); emit(); return; }
    var now=Date.now();
    if(now-lastEmit>1000){ lastEmit=now; emit(); }
    else if(!pending){ pending=setTimeout(function(){ pending=null; lastEmit=Date.now(); emit(); },1000); }
  }
  function pollREST(){
    fetch("https://api.exchange.coinbase.com/products/BTC-USD/stats").then(function(r){ return r.json(); })
      .then(function(j){ if(j && j.last) setPrice(parseFloat(j.last),parseFloat(j.open),"Coinbase"); })
      .catch(function(){});
  }
  function connectWS(){
    var ws, retry=0;
    function open(){
      try{ ws=new WebSocket("wss://ws-feed.exchange.coinbase.com"); }catch(e){ return; }
      ws.onopen=function(){ retry=0; ws.send(JSON.stringify({type:"subscribe",product_ids:["BTC-USD"],channels:["ticker"]})); };
      ws.onmessage=function(ev){
        var m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
        if(m.type==="ticker" && m.price) setPrice(parseFloat(m.price),parseFloat(m.open_24h),"Coinbase live");
      };
      ws.onclose=function(){ retry=Math.min(retry+1,6); setTimeout(open,1000*Math.pow(2,retry)); };
    }
    open();
  }
  pollREST(); connectWS();
  setInterval(function(){ if(!state.live) pollREST(); },30000);

  /* ---------- daily closes ----------
     daily(cb) hands cb the full run of completed UTC daily closes as {t:[ms],p:[usd]}. It reads
     data/btc-daily.js (pages that need it load that file) and, if the file is behind, fetches the
     missing completed days from Coinbase once. withLive() adds today's in-progress day. */
  var DAY=864e5, dailyP=null;
  function daily(cb){
    if(!dailyP) dailyP=new Promise(function(res){
      var d=window.BTC_DAILY && window.BTC_DAILY.daily;
      if(!d){ res(null); return; }
      var t0=Date.parse(d.start+"T00:00:00Z"), p=d.closes.slice();
      function done(){ res({t:p.map(function(_,i){ return t0+i*DAY; }), p:p}); }
      var next=t0+p.length*DAY, today=Math.floor(Date.now()/DAY)*DAY;
      if(next>=today){ done(); return; }
      fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start="+new Date(next).toISOString()+"&end="+new Date(Math.min(today,next+298*DAY)).toISOString())
        .then(function(r){ return r.json(); })
        .then(function(rows){
          var got={}; rows.forEach(function(r){ got[r[0]*1000]=+r[4]; });
          for(var t=next;t<today;t+=DAY){ if(got[t]==null && t>next+298*DAY) break; p.push(got[t]!=null?got[t]:p[p.length-1]); }
          done();
        }).catch(done);
    });
    dailyP.then(cb);
  }
  function withLive(S){
    var today=Math.floor(Date.now()/DAY)*DAY, last=S.t[S.t.length-1];
    if(!state.live || last>=today) return {t:S.t,p:S.p,live:false};
    return {t:S.t.concat([today]), p:S.p.concat([state.price]), live:true};
  }
  /* small stats helpers */
  function sma(a,n){ var out=new Array(a.length), s=0; for(var i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; out[i]=i>=n-1?s/n:null; } return out; }
  function quantile(sorted,q){ if(!sorted.length) return null; var x=(sorted.length-1)*q, i=Math.floor(x), f=x-i; return i+1<sorted.length?sorted[i]*(1-f)+sorted[i+1]*f:sorted[i]; }
  function rankPct(sorted,v){ var lo=0, hi=sorted.length; while(lo<hi){ var m=(lo+hi)>>1; if(sorted[m]<v) lo=m+1; else hi=m; } return sorted.length?lo/sorted.length*100:null; }

  /* ---------- mempool.space network API ---------- */
  function mempool(path){ return fetch("https://mempool.space/api"+path).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }

  /* ---------- halvings & supply ---------- */
  var HALVINGS=[
    {h:0,      date:"2009-01-03", label:"Genesis"},
    {h:210000, date:"2012-11-28", label:"1st halving"},
    {h:420000, date:"2016-07-09", label:"2nd halving"},
    {h:630000, date:"2020-05-11", label:"3rd halving"},
    {h:840000, date:"2024-04-19", label:"4th halving"}
  ];
  function subsidyAt(h){ var e=Math.floor(h/210000); return e>=64?0:Math.floor(50e8/Math.pow(2,e))/1e8; }
  function supplyAt(h){ /* coins issued through block h (inclusive), ignoring the unspendable genesis subtlety */
    var s=0, e=0, left=h+1;
    while(left>0 && e<34){ var n=Math.min(left,210000); s+=n*Math.floor(50e8/Math.pow(2,e))/1e8; left-=n; e++; }
    return s;
  }

  /* ---------- power-law model ----------
     Least-squares fit of log10(price) on log10(days since the genesis block), using
     month-end closes (each close is dated to the last day of its month). */
  var GENESIS=Date.UTC(2009,0,3);
  function daysSince(t){ return (t-GENESIS)/864e5; }
  function monthEnd(ymStr){ var p=ymStr.split("-"); return Date.UTC(+p[0],+p[1],0); }
  var PL=null;
  function powerLaw(){
    if(PL) return PL;
    var xs=[], ys=[];
    D.monthly.forEach(function(p){ xs.push(Math.log10(daysSince(monthEnd(p.date)))); ys.push(Math.log10(p.usd)); });
    var n=xs.length, mx=0, my=0; xs.forEach(function(x,i){ mx+=x; my+=ys[i]; }); mx/=n; my/=n;
    var sxy=0, sxx=0; xs.forEach(function(x,i){ sxy+=(x-mx)*(ys[i]-my); sxx+=(x-mx)*(x-mx); });
    var b=sxy/sxx, a=my-b*mx, ss=0;
    xs.forEach(function(x,i){ var r=ys[i]-(a+b*x); ss+=r*r; });
    var sigma=Math.sqrt(ss/(n-2));
    PL={a:a,b:b,sigma:sigma,
      fair:function(t){ return Math.pow(10,a+b*Math.log10(daysSince(t))); },
      band:function(t,k){ return Math.pow(10,a+b*Math.log10(daysSince(t))+k*sigma); },
      z:function(t,price){ return (Math.log10(price)-(a+b*Math.log10(daysSince(t))))/sigma; }};
    return PL;
  }

  /* ---------- tooltip placement ---------- */
  function placeTip(tt,box,e){
    var b=box.getBoundingClientRect();
    tt.classList.add("on");
    var px=e.clientX-b.left, py=e.clientY-b.top, tw=tt.offsetWidth, th=tt.offsetHeight;
    var lx=px+16, ly=py-th-10;
    if(lx+tw>b.width) lx=px-tw-16;
    if(ly<0) ly=py+16;
    tt.style.left=Math.max(0,lx)+"px"; tt.style.top=Math.max(0,ly)+"px";
  }
  /* logScale: a log axis fitted to [lo,hi] with a little headroom, ticked at 1-2-5 steps
     (whole decades only when that would crowd). Returns {a,b} in log10 units and ticks. */
  function logScale(lo,hi){
    var a=Math.log10(lo/1.3), b=Math.log10(hi*1.3), ticks=[];
    var steps=(b-a)>3.5?[1]:[1,2,5];
    for(var e=Math.floor(a);e<=Math.ceil(b);e++) steps.forEach(function(k){ var v=k*Math.pow(10,e), l=Math.log10(v); if(l>=a && l<=b) ticks.push(v); });
    return {a:a,b:b,ticks:ticks};
  }
  /* niceTicks: round grid values across [lo,hi] */
  function niceTicks(lo,hi,n){
    var span=hi-lo, step=Math.pow(10,Math.floor(Math.log10(span/(n||5)))), err=(n||5)/span*step;
    if(err<=.15) step*=10; else if(err<=.35) step*=5; else if(err<=.75) step*=2;
    var out=[]; for(var v=Math.ceil(lo/step)*step; v<=hi+1e-9; v+=step) out.push(+v.toFixed(10));
    return out;
  }

  /* ---------- chrome: top bar & footer ---------- */
  var MARK='<svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><rect x=".5" y=".5" width="19" height="19" rx="5" fill="none" stroke="var(--line2)"/><path d="M4.5 14 L8.5 9 L11.5 11.5 L15.5 5.5" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var SUN=ICO+'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON=ICO+'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var CARET='<svg class="caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8 5 6.8 8 3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var MENU=ICO+'<path d="M4 7h16M4 12h16M4 17h16"/></svg>', CLOSE=ICO+'<path d="M6 6l12 12M18 6 6 18"/></svg>';
  function chrome(){
    var here=(location.pathname.split("/").pop()||"index.html");
    var bar=document.createElement("header"); bar.className="topbar";
    function link(p,rich){ return '<a href="'+p.href+'"'+(p.href===here?' aria-current="page"':'')+'>'+(rich?'<b>'+p.label+'</b><span>'+p.desc+'</span>':p.label)+'</a>'; }
    var nav=NAV.map(function(g){
      if(!g.items) return link(g);
      var cur=g.items.some(function(p){ return p.href===here; });
      return '<div class="navgroup'+(cur?' cur':'')+'"><button type="button" aria-expanded="false" aria-haspopup="true">'+g.label+CARET+'</button><div class="navmenu">'+g.items.map(function(p){ return link(p,true); }).join("")+'</div></div>';
    }).join("");
    bar.innerHTML='<div class="in"><a class="brand" href="index.html">'+MARK+'<span class="name">BTC Graph</span></a>'+
      '<nav class="nav" id="nav" aria-label="Charts">'+nav+'</nav>'+
      '<span class="pricepill" id="pricepill" title="BTC-USD"><span class="live"></span><span class="lbl">BTC</span><span id="pillPrice">—</span><span class="chg" id="pillChg"></span></span>'+
      '<button class="themebtn" id="themebtn" type="button" aria-label="Toggle dark mode"></button>'+
      '<button class="themebtn menubtn" id="menubtn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav">'+MENU+'</button></div>';
    document.body.insertBefore(bar,document.body.firstChild);

    /* dropdown groups: open on click or hover, close on Escape, outside click or leaving */
    var groups=[].slice.call(bar.querySelectorAll(".navgroup"));
    function closeAll(except){ groups.forEach(function(g){ if(g!==except){ g.classList.remove("open"); g.firstChild.setAttribute("aria-expanded","false"); } }); }
    groups.forEach(function(g){
      var btn=g.firstChild, timer=null, openedAt=0;
      function open(on){ closeAll(on?g:null); if(on && !g.classList.contains("open")) openedAt=Date.now(); g.classList.toggle("open",on); btn.setAttribute("aria-expanded",on?"true":"false"); }
      /* a click right after the pointer arrived would close what hover just opened, so ignore that one */
      btn.addEventListener("click",function(){ var on=g.classList.contains("open"); if(on && Date.now()-openedAt<450) return; open(!on); });
      g.addEventListener("pointerenter",function(e){ if(e.pointerType==="mouse"){ clearTimeout(timer); open(true); } });
      g.addEventListener("pointerleave",function(e){ if(e.pointerType==="mouse") timer=setTimeout(function(){ open(false); },160); });
    });
    document.addEventListener("click",function(e){ if(!e.target.closest(".navgroup")) closeAll(); });
    var mb=document.getElementById("menubtn");
    function menu(on){ document.documentElement.classList.toggle("navopen",on); mb.setAttribute("aria-expanded",on?"true":"false"); mb.setAttribute("aria-label",on?"Close menu":"Open menu"); mb.innerHTML=on?CLOSE:MENU; }
    mb.addEventListener("click",function(){ menu(!document.documentElement.classList.contains("navopen")); });
    document.addEventListener("keydown",function(e){ if(e.key==="Escape"){ closeAll(); menu(false); } });

    var tb=document.getElementById("themebtn");
    function paint(){ tb.innerHTML=isDark()?SUN:MOON; }
    paint();
    tb.addEventListener("click",function(){
      var next=isDark()?"light":"dark";
      document.documentElement.setAttribute("data-theme",next); store("btcgraph.theme",next); paint();
      document.dispatchEvent(new Event("themechange"));
    });
    onPrice(function(s){
      document.getElementById("pillPrice").textContent=fmtUSD(s.price);
      var c=document.getElementById("pillChg");
      if(s.open24){ var ch=(s.price/s.open24-1)*100; c.textContent=fmtPct(ch); c.className="chg "+(ch>=0?"up":"down"); }
      document.getElementById("pricepill").classList.toggle("on",s.live);
    });
    var main=document.querySelector("main");
    if(main){
      /* previous / next chart, so the site reads as a tour */
      var i=PAGES.findIndex(function(p){ return p.href===here; });
      if(i>=0){
        var prev=PAGES[(i+PAGES.length-1)%PAGES.length], next=PAGES[(i+1)%PAGES.length];
        var pg=document.createElement("nav"); pg.className="pager"; pg.setAttribute("aria-label","More charts");
        pg.innerHTML='<a href="'+prev.href+'" rel="prev"><span>← Previous</span><b>'+prev.label+'</b><i>'+prev.desc+'</i></a>'+
          '<a href="'+next.href+'" rel="next"><span>Next →</span><b>'+next.label+'</b><i>'+next.desc+'</i></a>';
        main.appendChild(pg);
      }
      var f=document.createElement("div"); f.className="sitefoot";
      f.innerHTML='<span>BTC Graph · price history through '+D.updated+'</span><span>Prices: Coinbase (Bitstamp before mid-2015) · Network: mempool.space</span><span>Not financial advice. Past patterns do not predict future prices.</span>';
      main.appendChild(f);
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",chrome); else chrome();

  window.BTC = {
    data:D, MONTHS:MONTHS, HALVINGS:HALVINGS,
    fmtMonth:fmtMonth, fmtUSD:fmtUSD, fmtCompact:fmtCompact, fmtPct:fmtPct, fmtDate:fmtDate, fmtDay:fmtDay, fmtMult:fmtMult, ym:ym, PAGES:PAGES, DAY:DAY,
    daily:daily, withLive:withLive, sma:sma, quantile:quantile, rankPct:rankPct, price:function(){ return state.price; },
    onPrice:onPrice, mempool:mempool, subsidyAt:subsidyAt, supplyAt:supplyAt,
    powerLaw:powerLaw, daysSince:daysSince, monthEnd:monthEnd, GENESIS:GENESIS,
    placeTip:placeTip, niceTicks:niceTicks, logScale:logScale, isDark:isDark, store:store,
    /* monthly closes with the current month's close replaced by the live price */
    monthlyLive:function(){
      var m=D.monthly.slice(), cur=ym(new Date());
      if(m.length && m[m.length-1].date===cur) m[m.length-1]={date:cur,usd:state.price,partial:true};
      else if(state.live) m.push({date:cur,usd:state.price,partial:true});
      return m;
    }
  };
})();

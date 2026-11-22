/* BTC Graph — time-series chart helper.
   BTC.chart(box, cfg) draws one responsive SVG chart into `box` and keeps it sized to the box.
   `cfg` is an object, or a function returning one (called on every draw, so a page can change
   state and call .draw() again).

   cfg = {
     label:    accessible description of the chart,
     height:   function(width) -> px (optional),
     t0, t1:   time domain in ms (default: extent of the series),
     y:        {scale:"lin"|"log", min, max, fmt:function(v), include:[values the axis must cover]},
     series:   [{name, t:[ms], v:[number|null], color, width, dash, area, opacity,
                 split:{at, above, below},   color the line and fill by which side of `at` it is on
                 end:function(v)->string,    label at the right edge of the line
                 fmt:function(v), hover:false}],
     bands:    [{y0, y1, color, opacity, label, short}],   horizontal zones (short: label on phones)
     hlines:   [{y, label, color, dash}],
     halvings: true,                                dashed markers with tags above the plot
     marks:    [{t, v, label, color, dy}],  dots with a text label; dy>0 prefers below the dot
     xfmt:     function(t) for the tooltip header,
     tipExtra: function(t) -> extra tooltip rows (html),
     onHover:  function(t), onLeave: function()
   } */
(function(){
  var B=window.BTC, DAY=B.DAY, seq=0;

  /* index of the element of sorted `ts` nearest to t */
  function nearest(ts,t){
    var lo=0, hi=ts.length-1;
    if(hi<0) return -1;
    while(hi-lo>1){ var m=(lo+hi)>>1; if(ts[m]<t) lo=m; else hi=m; }
    return Math.abs(ts[lo]-t)<=Math.abs(ts[hi]-t)?lo:hi;
  }
  /* line segments (split at gaps); long series are reduced to a min and max per pixel column */
  function segments(s,i0,i1,X,Y,PW,ok){
    var segs=[], cur=null, dense=(i1-i0)>PW*2.5, px=null, mn, mx, mnI, mxI;
    function add(x,y){ if(!cur){ cur=[]; segs.push(cur); } cur.push([x,y]); }
    function flush(){
      if(px==null) return;
      if(mn===mx) add(px,Y(mn)); else if(mnI<mxI){ add(px,Y(mn)); add(px,Y(mx)); } else { add(px,Y(mx)); add(px,Y(mn)); }
      px=null;
    }
    for(var i=i0;i<=i1;i++){
      var v=s.v[i];
      if(v==null || !isFinite(v) || !ok(v)){ flush(); cur=null; continue; }
      if(!dense){ add(X(s.t[i]),Y(v)); continue; }
      var x=Math.round(X(s.t[i]));
      if(x!==px){ flush(); px=x; mn=mx=v; mnI=mxI=i; }
      else { if(v<mn){ mn=v; mnI=i; } if(v>mx){ mx=v; mxI=i; } }
    }
    flush();
    return segs;
  }
  function pathOf(seg){ return seg.map(function(p,k){ return (k?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1); }).join(" "); }
  function xTicks(t0,t1,PW){
    var out=[], span=(t1-t0)/DAY, d0=new Date(t0), y, m;
    if(span>800){
      var step=Math.max(1,Math.ceil((span/365.25)/(PW/54)));
      for(y=d0.getUTCFullYear();;y++){ var t=Date.UTC(y,0,1); if(t>t1) break; if(t>=t0 && y%step===0) out.push({t:t,label:String(y)}); }
    } else {
      var stepM=Math.max(1,Math.ceil((span/30.44)/(PW/64)));
      y=d0.getUTCFullYear(); m=d0.getUTCMonth();
      for(;;){ var tm=Date.UTC(y,m,1); if(tm>t1) break; if(tm>=t0 && m%stepM===0) out.push({t:tm,label:B.MONTHS[m]+(m===0||out.length===0?" ’"+String(y).slice(2):"")}); m++; if(m>11){ m=0; y++; } }
    }
    return out;
  }

  B.chart=function(box,cfg){
    var id="ch"+(++seq), lastW=0;
    box.classList.add("chartbox");
    var holder=document.createElement("div"), tip=document.createElement("div");
    tip.className="tooltip"; tip.setAttribute("role","status");
    box.appendChild(holder); box.appendChild(tip);

    function draw(){
      var c=typeof cfg==="function"?cfg():cfg;
      if(!c || box.clientWidth<60) return;
      var W=box.clientWidth, nar=W<560; lastW=W;
      var H=Math.round(c.height?c.height(W):Math.min(430,Math.max(250,W*.44)));
      var series=c.series.filter(function(s){ return s && s.t && s.t.length; });
      var hasEnd=series.some(function(s){ return s.end; });
      var tagBand=c.halvings?22:0;
      var ML=nar?46:58, MR=hasEnd?(nar?66:92):14, MT=12+tagBand, MB=26, PW=W-ML-MR, PH=H-MT-MB;
      var yc=c.y||{}, log=yc.scale==="log";
      var fmtY=yc.fmt||function(v){ return "$"+B.fmtCompact(v); };

      /* domains */
      var t0=c.t0, t1=c.t1;
      if(t0==null) t0=Math.min.apply(null,series.map(function(s){ return s.t[0]; }));
      if(t1==null) t1=Math.max.apply(null,series.map(function(s){ return s.t[s.t.length-1]; }));
      var lo=Infinity, hi=-Infinity;
      series.forEach(function(s){
        s._i0=Math.max(0,nearest(s.t,t0)-1); s._i1=Math.min(s.t.length-1,nearest(s.t,t1)+1);
        for(var i=s._i0;i<=s._i1;i++){ var v=s.v[i]; if(v==null || !isFinite(v) || (log && v<=0) || s.t[i]<t0 || s.t[i]>t1) continue; if(v<lo) lo=v; if(v>hi) hi=v; }
      });
      (yc.include||[]).forEach(function(v){ if(v<lo) lo=v; if(v>hi) hi=v; });
      if(yc.min!=null) lo=yc.min; if(yc.max!=null) hi=yc.max;
      if(!isFinite(lo) || !isFinite(hi)){ holder.innerHTML=""; return; }
      if(hi===lo){ hi=lo+1; }
      var ticks, Y, d0, d1;
      if(log){
        var ls=B.logScale(lo,hi); d0=ls.a; d1=ls.b; ticks=ls.ticks;
        if(PH/ticks.length<20) ticks=ticks.filter(function(v){ return /^1/.test(v.toExponential()); });
        Y=function(v){ return MT+(1-(Math.log10(v)-d0)/(d1-d0))*PH; };
      } else {
        var pad=(hi-lo)*.06;
        ticks=B.niceTicks(yc.min!=null?lo:lo-pad, yc.max!=null?hi:hi+pad, Math.max(3,Math.round(PH/56)));
        var step=ticks.length>1?ticks[1]-ticks[0]:1;
        if(yc.min==null) while(ticks[0]>lo) ticks.unshift(+(ticks[0]-step).toFixed(10));
        if(yc.max==null) while(ticks[ticks.length-1]<hi) ticks.push(+(ticks[ticks.length-1]+step).toFixed(10));
        d0=yc.min!=null?lo:ticks[0]; d1=yc.max!=null?hi:ticks[ticks.length-1];
        Y=function(v){ return MT+(1-(v-d0)/(d1-d0))*PH; };
      }
      function X(t){ return ML+(t-t0)/(t1-t0)*PW; }
      var ok=log?function(v){ return v>0; }:function(){ return true; };
      var yBase=MT+PH;

      var s='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+(c.label||"Chart").replace(/"/g,"&quot;")+'">';
      s+='<defs><clipPath id="'+id+'p"><rect x="'+ML+'" y="'+MT+'" width="'+PW+'" height="'+PH+'"/></clipPath>';
      series.forEach(function(sr,k){
        if(!sr.split) return;
        var ys=Math.max(MT,Math.min(yBase,Y(sr.split.at)));
        s+='<clipPath id="'+id+'a'+k+'"><rect x="'+ML+'" y="'+MT+'" width="'+PW+'" height="'+(ys-MT)+'"/></clipPath>'+
           '<clipPath id="'+id+'b'+k+'"><rect x="'+ML+'" y="'+ys+'" width="'+PW+'" height="'+(yBase-ys)+'"/></clipPath>';
      });
      s+='</defs>';

      /* zones sit behind the grid */
      (c.bands||[]).forEach(function(b){
        var ya=Math.max(MT,Math.min(yBase,Y(Math.min(Math.max(b.y1,log?Math.pow(10,d0):d0),log?Math.pow(10,d1):d1))));
        var yb=Math.max(MT,Math.min(yBase,Y(Math.min(Math.max(b.y0,log?Math.pow(10,d0):d0),log?Math.pow(10,d1):d1))));
        if(yb-ya<1) return;
        s+='<rect x="'+ML+'" y="'+ya+'" width="'+PW+'" height="'+(yb-ya)+'" fill="'+b.color+'" fill-opacity="'+(b.opacity||.08)+'"/>';
        if(b.label && yb-ya>=15) s+='<text class="tick halo" x="'+(ML+8)+'" y="'+(ya+13)+'" style="fill:'+b.color+'">'+(nar && b.short?b.short:b.label)+'</text>';
      });
      ticks.forEach(function(g){
        var y=Y(g); if(y<MT-1 || y>yBase+1) return;
        s+='<line class="'+(!log && g===0?"axis":"grid")+'" x1="'+ML+'" y1="'+y+'" x2="'+(ML+PW)+'" y2="'+y+'"/>';
        s+='<text class="tick" x="'+(ML-8)+'" y="'+(y+4)+'" text-anchor="end">'+fmtY(g)+'</text>';
      });
      xTicks(t0,t1,PW).forEach(function(k){
        s+='<text class="tick" x="'+X(k.t)+'" y="'+(yBase+18)+'" text-anchor="middle">'+k.label+'</text>';
      });
      if(c.halvings){
        var lastX=-1e9;
        B.HALVINGS.forEach(function(h,i){
          var t=Date.parse(h.date+"T00:00:00Z"); if(!i || t<t0 || t>t1) return;
          var x=X(t), lbl=nar?"H"+i:"H"+i+" · "+h.date.slice(0,4);
          s+='<line x1="'+x+'" y1="'+(MT-8)+'" x2="'+x+'" y2="'+yBase+'" stroke="var(--muted)" stroke-dasharray="2 4" opacity=".55"/>';
          s+='<circle cx="'+x+'" cy="'+(MT-8)+'" r="2.5" fill="var(--muted)"/>';
          if(x-lastX>(nar?26:74) && x+ (nar?22:70) < W){ s+='<text class="tick" x="'+(x+6)+'" y="'+(MT-4)+'">'+lbl+'</text>'; lastX=x; }
        });
      }
      (c.hlines||[]).forEach(function(h){
        var y=Y(h.y); if(y<MT || y>yBase) return;
        s+='<line x1="'+ML+'" y1="'+y+'" x2="'+(ML+PW)+'" y2="'+y+'" stroke="'+(h.color||"var(--muted)")+'" stroke-dasharray="'+(h.dash||"4 3")+'" opacity=".8"/>';
        if(h.label && !nar) s+='<text class="tick halo" x="'+(ML+PW-6)+'" y="'+(y-5)+'" text-anchor="end" style="fill:'+(h.color||"var(--muted)")+'">'+h.label+'</text>';
      });

      /* series */
      var ends=[];
      s+='<g clip-path="url(#'+id+'p)">';
      series.forEach(function(sr,k){
        var segs=segments(sr,sr._i0,sr._i1,X,Y,PW,ok), w=sr.width||1.8, dash=sr.dash?' stroke-dasharray="'+sr.dash+'"':'';
        var line=segs.map(pathOf).join(" "), op=sr.opacity!=null?' opacity="'+sr.opacity+'"':'';
        function area(base){ return segs.map(function(g){ return g.length<2?"":pathOf(g)+" L"+g[g.length-1][0].toFixed(1)+" "+base+" L"+g[0][0].toFixed(1)+" "+base+" Z"; }).join(" "); }
        if(sr.split){
          var ys=Math.max(MT,Math.min(yBase,Y(sr.split.at))), ar=area(ys.toFixed(1));
          [["a",sr.split.above],["b",sr.split.below]].forEach(function(q){
            s+='<g clip-path="url(#'+id+q[0]+k+')"><path d="'+ar+'" fill="'+q[1]+'" fill-opacity=".14"/><path d="'+line+'" fill="none" stroke="'+q[1]+'" stroke-width="'+w+'" stroke-linejoin="round"/></g>';
          });
        } else {
          if(sr.area) s+='<path d="'+area(yBase)+'" fill="'+sr.color+'" fill-opacity="'+(sr.area===true?.1:sr.area)+'"/>';
          s+='<path d="'+line+'" fill="none" stroke="'+sr.color+'" stroke-width="'+w+'" stroke-linejoin="round" stroke-linecap="round"'+dash+op+'/>';
        }
        if(sr.end){
          for(var i=sr._i1;i>=sr._i0;i--){ var v=sr.v[i]; if(v!=null && isFinite(v) && ok(v) && sr.t[i]<=t1){
            var col=sr.split?(v>=sr.split.at?sr.split.above:sr.split.below):sr.color;
            ends.push({x:X(sr.t[i]), y:Y(v), yl:Y(v), text:sr.end(v), color:col}); break; } }
        }
      });
      s+='</g>';
      /* point labels: try a few positions around each dot and keep the first that is inside the
         plot and clear of every other dot and label; a label with no free spot is left out */
      var marks=(c.marks||[]).filter(function(m){ return m.t>=t0 && m.t<=t1; }), taken=[];
      marks.forEach(function(m){ m._x=X(m.t); m._y=Y(m.v); taken.push({x0:m._x-6,x1:m._x+6,y0:m._y-6,y1:m._y+6}); });
      marks.forEach(function(m){
        var x=m._x, y=m._y, col=m.color||"var(--ink)";
        s+='<circle cx="'+x+'" cy="'+y+'" r="4" fill="'+col+'" stroke="var(--surface)" stroke-width="2"/>';
        if(!m.label) return;
        var w=m.label.length*6.2+4, below=(m.dy||-10)>0;
        var cands=[["middle",0,below?18:-10],["start",9,below?18:-10],["end",-9,below?18:-10],["start",10,4],["end",-10,4],["middle",0,below?-10:18],["start",9,below?-10:18],["end",-9,below?-10:18]];
        for(var k=0;k<cands.length;k++){
          var q=cands[k], tx=x+q[1], ty=y+q[2];
          var bx={x0:q[0]==="middle"?tx-w/2:q[0]==="start"?tx:tx-w, y0:ty-11, y1:ty+4}; bx.x1=bx.x0+w;
          if(bx.x0<ML+2 || bx.x1>ML+PW-2 || bx.y0<MT || bx.y1>yBase) continue;
          if(taken.some(function(o){ return !(bx.x1<o.x0 || bx.x0>o.x1 || bx.y1<o.y0 || bx.y0>o.y1); })) continue;
          taken.push(bx);
          s+='<text class="anno ink halo" x="'+tx+'" y="'+ty+'" text-anchor="'+q[0]+'">'+m.label+'</text>';
          break;
        }
      });
      /* right-edge labels, nudged apart so they never overlap */
      ends.sort(function(a,b){ return a.yl-b.yl; });
      for(var e=1;e<ends.length;e++) if(ends[e].yl-ends[e-1].yl<14) ends[e].yl=ends[e-1].yl+14;
      for(e=ends.length-1;e>=0;e--){ var cap=yBase-(ends.length-1-e)*14; if(ends[e].yl>cap) ends[e].yl=cap; }
      ends.forEach(function(q){
        s+='<circle cx="'+q.x+'" cy="'+q.y+'" r="3.5" fill="'+q.color+'" stroke="var(--surface)" stroke-width="1.5"/>';
        s+='<text class="endlabel" x="'+(ML+PW+8)+'" y="'+(q.yl+4)+'" style="fill:'+q.color+'">'+q.text+'</text>';
      });
      s+='<g id="'+id+'f"></g><rect id="'+id+'h" x="'+ML+'" y="'+MT+'" width="'+PW+'" height="'+PH+'" fill="transparent"/></svg>';
      holder.innerHTML=s; tip.classList.remove("on");

      /* hover: one vertical guide, a dot on every series, values in the tooltip */
      var hz=document.getElementById(id+"h"), fo=document.getElementById(id+"f");
      var prim=series[c.hoverSeries||0];
      hz.addEventListener("pointermove",function(ev){
        var r=holder.firstChild.getBoundingClientRect(), t=t0+((ev.clientX-r.left)/r.width*W-ML)/PW*(t1-t0);
        var pi=nearest(prim.t,Math.max(t0,Math.min(t1,t))), th=prim.t[pi];
        var g='<line x1="'+X(th)+'" y1="'+MT+'" x2="'+X(th)+'" y2="'+yBase+'" stroke="var(--muted)" stroke-dasharray="4 3"/>';
        var rows="";
        series.forEach(function(sr){
          if(sr.hover===false) return;
          var j=nearest(sr.t,th), v=sr.v[j];
          if(j<0 || v==null || !isFinite(v) || Math.abs(sr.t[j]-th)>DAY*20) return;
          var col=sr.split?(v>=sr.split.at?sr.split.above:sr.split.below):sr.color;
          if(ok(v)) g+='<circle cx="'+X(sr.t[j])+'" cy="'+Y(v)+'" r="4.5" fill="var(--surface)" stroke="'+col+'" stroke-width="2"/>';
          rows+='<div class="row"><span class="dot" style="background:'+col+'"></span><span class="nm">'+sr.name+'</span><span class="vv">'+(sr.fmt||fmtY)(v)+'</span></div>';
        });
        fo.innerHTML=g;
        tip.innerHTML='<h3>'+(c.xfmt||B.fmtDay)(th)+'</h3>'+rows+(c.tipExtra?c.tipExtra(th)||"":"");
        B.placeTip(tip,box,ev);
        if(c.onHover) c.onHover(th);
      });
      hz.addEventListener("pointerleave",function(){ fo.innerHTML=""; tip.classList.remove("on"); if(c.onLeave) c.onLeave(); });
    }
    if(window.ResizeObserver) new ResizeObserver(function(){ if(Math.abs(box.clientWidth-lastW)>1) draw(); }).observe(box);
    draw();
    return {draw:draw};
  };
  B.nearest=nearest;
})();

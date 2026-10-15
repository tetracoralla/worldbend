// Version 1 deterministic demo artwork. No random values, network assets or captured DOM.
export function makeArtwork(theme=0, image){
  const W=600,H=400;
  const canvas=()=>{const c=document.createElement('canvas');c.width=W*2;c.height=H*2;return c;};
  const layers=Object.fromEntries(['background','middle','foreground'].map(id=>[id,canvas()]));
  const colors=[['#dbe7d2','#234f3b','#99b987'],['#e8dbd0','#6b3f31','#d5a881'],['#d4dfe8','#314c6b','#8daeca']][theme%3];
  for(const [id,layer]of Object.entries(layers)){
    const c=layer.getContext('2d');c.scale(2,2);
    if(image){if(id==='background'){const scale=Math.max(W/image.width,H/image.height);c.drawImage(image,(W-image.width*scale)/2,(H-image.height*scale)/2,image.width*scale,image.height*scale);}continue;}
    if(id==='background'){
      const g=c.createLinearGradient(0,0,W,H);g.addColorStop(0,'#f5f5ed');g.addColorStop(1,colors[0]);c.fillStyle=g;c.fillRect(0,0,W,H);
      c.strokeStyle=colors[2]+'55';c.lineWidth=.7;
      for(let i=0;i<8;i++){c.beginPath();c.ellipse(390,160,100+i*24,140+i*23,-.3,0,Math.PI*2);c.stroke();}
      c.fillStyle=colors[1];c.font='500 11px system-ui';c.fillText('STUDY 0'+(theme+1)+'  /  WORLDBEND',30,34);
      c.font='500 33px system-ui';c.fillText(['Quiet orbit.','Soft gravity.','A new angle.'][theme%3],30,91);
      c.fillStyle=colors[1]+'b0';c.font='12px system-ui';c.fillText(['一件物体，几种观看方式。','空间，让细节有了距离。','换个角度，关系依然成立。'][theme%3],31,118);
      c.fillStyle=colors[1]+'80';c.font='10px system-ui';c.fillText('FORM / LIGHT / DISTANCE',370,369);
    }
    if(id==='middle'){
      const shadow=c.createRadialGradient(351,313,5,351,313,119);shadow.addColorStop(0,colors[1]+'60');shadow.addColorStop(1,colors[1]+'00');
      c.save();c.translate(0,169);c.scale(1,.46);c.fillStyle=shadow;c.fillRect(190,190,310,245);c.restore();
      for(let y=317;y>=288;y--){c.fillStyle=y===288?'#fcfcf4':`rgb(${202+(317-y)*.55},${215+(317-y)*.5},${192+(317-y)*.6})`;c.beginPath();c.ellipse(351,y,100,31,0,0,Math.PI*2);c.fill();}
      c.strokeStyle='#ffffffb0';c.lineWidth=1;c.beginPath();c.ellipse(351,288,99,30,0,0,Math.PI*2);c.stroke();
      c.save();c.translate(191,249);c.rotate(-.2);c.fillStyle=colors[2];c.fillRect(-16,-16,32,32);c.fillStyle='#ffffff45';c.fillRect(-16,-16,32,8);c.restore();
    }
    if(id==='foreground'){
      const g=c.createRadialGradient(310,183,8,355,236,107);g.addColorStop(0,'#fffef5');g.addColorStop(.42,'#eaf0de');g.addColorStop(.76,colors[2]);g.addColorStop(1,colors[1]);
      c.fillStyle=g;c.beginPath();c.arc(353,214,76,0,Math.PI*2);c.fill();
      c.save();c.beginPath();c.arc(353,214,76,0,Math.PI*2);c.clip();c.strokeStyle=colors[1]+'30';c.lineWidth=1;
      for(let i=-2;i<7;i++){c.beginPath();c.ellipse(323+i*13,203,23+i*3,95,-.18,0,Math.PI*2);c.stroke();}c.restore();
      c.fillStyle=colors[1];c.beginPath();c.arc(477,178,13,0,Math.PI*2);c.fill();c.fillStyle='#fff9';c.beginPath();c.arc(473,174,3,0,Math.PI*2);c.fill();
    }
  }
  const full=canvas();for(const layer of Object.values(layers))full.getContext('2d').drawImage(layer,0,0);
  return {...layers,full};
}

export function createScene(recipe, artwork, onTouch){
  const stage=document.createElement('div');stage.className='stage';stage.style.width=recipe.viewport.width+'px';stage.style.height=recipe.viewport.height+'px';
  const slots=Object.create(null);
  const add=(id,size,kind,start=0,end=1,offset={x:0,y:0})=>{
    let element;
    if(kind==='window'){element=document.createElement('canvas');element.className='effect-surface texture-window';slots[id]={element,source:artwork.full};}
    else {
      element=document.createElement('div');element.className='effect-surface';element.dataset.layer=id;
      const art=document.createElement('canvas');art.width=Math.max(1,Math.round(size.width*2));art.height=Math.max(1,Math.round(size.height*2));art.className='scene-canvas';
      const source=artwork[id] || artwork.full;
      const context=art.getContext('2d');
      if(kind==='camera-plane'){
        const x=-offset.x*2,y=-offset.y*2,w=recipe.viewport.width*2,h=recipe.viewport.height*2;
        if(id==='background'){
          context.drawImage(source,0,0,source.width,1,x,0,w,Math.max(1,y));context.drawImage(source,0,source.height-1,source.width,1,x,y+h,w,Math.max(1,art.height-y-h));
          context.drawImage(source,0,0,1,source.height,0,y,Math.max(1,x),h);context.drawImage(source,source.width-1,0,1,source.height,x+w,y,Math.max(1,art.width-x-w),h);
          context.fillStyle='#f5f5ed';context.fillRect(0,0,Math.max(0,x),Math.max(0,y));context.fillRect(x+w,0,Math.max(0,art.width-x-w),Math.max(0,y));context.fillRect(0,y+h,Math.max(0,x),Math.max(0,art.height-y-h));context.fillRect(x+w,y+h,Math.max(0,art.width-x-w),Math.max(0,art.height-y-h));
        }
        context.drawImage(source,0,0,source.width,source.height,x,y,w,h);
      }else context.drawImage(source,start*source.width,0,(end-start)*source.width,source.height,0,0,art.width,art.height);
      element.append(art);
      if(id==='foreground'||id==='content'){
        const button=document.createElement('button');button.className='native-touch';button.textContent='触碰一下';if(kind==='camera-plane'){button.style.left=30-offset.x+'px';button.style.bottom=25-offset.y+'px';}button.addEventListener('click',e=>{e.stopPropagation();button.textContent='已触碰';onTouch();});element.append(button);
      }
      slots[id]={element};
    }
    stage.append(element);
  };
  for(const layer of recipe.layers){
    const s=layer.surface;
    if(s.kind==='strip')for(const panel of s.panels)add(panel.id,panel.elementSize,'plane',panel.start,panel.end);
    else add(layer.id,s.kind==='window'?s.spec.windowSize:s.size,s.kind,0,1,layer.offset);
  }
  return {stage,slots};
}

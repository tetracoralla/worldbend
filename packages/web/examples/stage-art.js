// Original procedural toy artwork, version 1. No external assets or font fetch.
// Subject, plinth and contact shadow are one foreground layer by design.
export function stageArt(theme=0) {
  const palette=[['#daf5d5','#a8bc65','#243c32'],['#dfeeff','#9daee3','#343e60']][theme];
  const layers={};
  for(const id of ['background','middle','foreground']){
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
    const c=canvas.getContext('2d');c.scale(2,2);layers[id]=canvas;
    const ellipse=(x,y,rx,ry,fill)=>{c.fillStyle=fill;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();};
    const round=(x,y,w,h,r,fill)=>{c.fillStyle=fill;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
    if(id==='background'){
      const g=c.createLinearGradient(0,0,600,400);g.addColorStop(0,'#f8f8ef');g.addColorStop(1,palette[0]);c.fillStyle=g;c.fillRect(0,0,600,400);
      c.strokeStyle=palette[1]+'65';c.lineWidth=1;
      for(let i=0;i<6;i++){c.beginPath();c.ellipse(320,430,115+i*60,110+i*24,0,Math.PI,Math.PI*2);c.stroke();}
      c.strokeStyle='#fff9';c.lineWidth=32;c.beginPath();c.arc(310,230,176,Math.PI,Math.PI*2);c.stroke();
      c.fillStyle=palette[2];c.font='500 12px system-ui';c.fillText('FIELD NOTES  /  001',40,46);
      c.font='500 32px system-ui';c.fillText(theme?'Moon keeper.':'Little explorer.',40,89);
      c.fillStyle=palette[2]+'99';c.font='13px system-ui';c.fillText('一方小天地，一位老朋友。',41,114);
      c.font='11px system-ui';c.fillText('OPEN STUDIO  /  ORIGINAL TOY',40,368);
    }else if(id==='middle'){
      c.save();c.translate(150,208);c.rotate(-.3);round(-16,-16,32,32,8,palette[1]);round(-11,-13,22,6,3,'#fff7');c.restore();
      ellipse(460,144,16,16,palette[2]);ellipse(455,138,5,4,'#fff8');
      c.strokeStyle=palette[1];c.lineWidth=6;c.beginPath();c.ellipse(441,266,22,11,-.5,0,Math.PI*2);c.stroke();
      ellipse(186,302,4,4,palette[1]);ellipse(402,110,3,3,palette[1]);
    }else{
      ellipse(308,336,110,20,palette[2]+'12');
      for(let y=328;y>=301;y--)ellipse(306,y,90,25,y===301?'#fcfcf4':'#c8d2b9');
      ellipse(306,303,53,13,palette[2]+'32');
      round(265,270,33,36,12,palette[2]);round(315,270,33,36,12,palette[2]);
      round(230,210,29,51,14,palette[1]);round(353,210,29,51,14,palette[1]);
      const body=c.createLinearGradient(251,200,359,275);body.addColorStop(0,'#fffff2');body.addColorStop(1,palette[1]);round(251,192,109,91,29,body);
      round(275,224,60,34,11,palette[2]);round(284,234,20,4,2,palette[1]);round(310,234,15,4,2,'#fff8');
      round(296,124,13,20,6,palette[2]);ellipse(302,119,8,8,palette[1]);
      const head=c.createLinearGradient(238,140,366,216);head.addColorStop(0,'#fffff7');head.addColorStop(1,palette[1]);round(237,139,129,78,26,head);
      round(250,157,102,40,17,palette[2]);
      ellipse(278,176,7,9,'#e6f7cc');ellipse(327,176,7,9,'#e6f7cc');
      round(292,191,19,3,2,'#d5e9b7');
      c.fillStyle='#ffffffc0';c.beginPath();c.ellipse(259,148,11,3,-.2,0,Math.PI*2);c.fill();
    }
  }
  const full=document.createElement('canvas');full.width=1200;full.height=800;
  for(const c of Object.values(layers))full.getContext('2d').drawImage(c,0,0);
  return {...layers,content:full};
}

export function mountStage(root, ids, art) {
  const slots={};
  for(const id of ids){
    const node=document.createElement('div');node.className='scene-layer';node.dataset.layer=id;
    const copy=document.createElement('canvas');copy.width=1200;copy.height=800;copy.getContext('2d').drawImage(art[id],0,0);
    node.append(copy);root.append(node);slots[id]=node;
  }
  return slots;
}

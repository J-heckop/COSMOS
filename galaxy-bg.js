import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

const canvas=document.querySelector('#galaxy-scene');
const renderer=new THREE.WebGL1Renderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight,false);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.VSMShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);scene.fog=new THREE.Fog(0x000000,0,15);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,80);camera.position.set(0,0,14);scene.add(camera);
const LAYERS={TORUS_SCENE:1,BLOOM_SCENE:2,ENTIRE_SCENE:3};
camera.layers.enable(1);camera.layers.enable(2);camera.layers.enable(3);
const vec=h=>{const n=parseInt(h.slice(1),16);return new THREE.Vector3((n>>16&255)/255,(n>>8&255)/255,(n&255)/255)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const vertex=`
attribute float size;attribute float id;attribute float shell;
uniform float iTime;uniform float iAnimate;uniform float uExpand;uniform float uWobbleAmount;uniform float uWobbleSpeed;
varying float vShell;varying float vId;
void main(){vShell=shell;vId=id;float ph=id*6.2831853;
vec3 wob=vec3(sin(iTime*uWobbleSpeed+ph),cos(iTime*uWobbleSpeed*1.3+ph),sin(iTime*uWobbleSpeed*.7+ph))*uWobbleAmount;
vec3 p=(position+wob)*uExpand;vec4 mv=modelViewMatrix*vec4(p,1.);
gl_PointSize=size/-mv.z*(.5+.5*iAnimate)*2.4;vec4 res=projectionMatrix*mv;float a=pow(iAnimate,.6);
res.xy*=clamp(2.*a+pow(id,.7)-1.,0.,1.);gl_Position=res;}`;
const fragment=`
uniform float iTime;uniform float uOpacity;uniform vec3 uCore;uniform vec3 uMid;uniform vec3 uRim;uniform vec3 uTwinkle;
uniform float uGradientPow;uniform float uTwinkleAmount;uniform float uTwinkleSpeed;varying float vShell;varying float vId;
vec3 grad3(vec3 a,vec3 b,vec3 c,float t){return t<.5?mix(a,b,t*2.):mix(b,c,clamp((t-.5)*2.,0.,1.));}
void main(){float t=pow(vShell,uGradientPow);vec3 col=grad3(uCore,uMid,uRim,t);
float tw=.5+.5*sin(iTime*uTwinkleSpeed+vId*100.);col=mix(col,uTwinkle,tw*uTwinkleAmount*(1.-t));
col*=.7+1.05*(1.-t);float tex=1.-smoothstep(.5,1.,length(2.*gl_PointCoord-1.));gl_FragColor=vec4(col*tex*1.35,tex*uOpacity);}`;
const N=90000,K=79,R=1.7,SP=13;
const pos=new Float32Array(N*3),shell=new Float32Array(N),sizes=new Float32Array(N),ids=new Float32Array(N),frames=[];
for(let k=0;k<K;k++)frames.push({m:new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI)),size:.18+.34*Math.random(),ecc:.45+.42*Math.random(),thick:.06+.05*Math.random(),ox:(Math.random()-.5)*2*SP,oy:(Math.random()-.5)*2*SP,oz:(Math.random()-.5)*2*SP*.6});
const tmp=new THREE.Vector3();
for(let i=0;i<N;i++){const f=frames[i%K],th=Math.random()*Math.PI*2,rad=Math.pow(Math.random(),1.4),rx=f.size*R*rad,rz=f.size*R*f.ecc*rad,y=(Math.random()-.5)*2*f.thick*R*rad;
tmp.set(rx*Math.cos(th),y,rz*Math.sin(th)).applyMatrix4(f.m);tmp.x+=f.ox;tmp.y+=f.oy;tmp.z+=f.oz;
pos.set([tmp.x,tmp.y,tmp.z],i*3);shell[i]=rad;sizes[i]=6+9*Math.random();ids[i]=Math.random();}
const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('shell',new THREE.BufferAttribute(shell,1));geo.setAttribute('size',new THREE.BufferAttribute(sizes,1));geo.setAttribute('id',new THREE.BufferAttribute(ids,1));
const uniforms={iTime:{value:0},iAnimate:{value:0},uOpacity:{value:1},uExpand:{value:1},uWobbleAmount:{value:.205},uWobbleSpeed:{value:.35},uCore:{value:vec('#fff3b0')},uMid:{value:vec('#ffb52a')},uRim:{value:vec('#3a1402')},uTwinkle:{value:vec('#ff5e8a')},uGradientPow:{value:.2},uTwinkleAmount:{value:.71},uTwinkleSpeed:{value:2.45}};
const galaxyMat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,blending:THREE.AdditiveBlending,depthTest:false,transparent:true});
const group=new THREE.Group();group.position.z=-20;group.visible=false;scene.add(group);
const cloud=new THREE.Points(geo,galaxyMat);cloud.position.z=-.8;cloud.layers.set(LAYERS.ENTIRE_SCENE);group.add(cloud);
const M=350,mp=new Float32Array(M*3),ms=new Float32Array(M),seed=new Float32Array(M);
for(let i=0;i<M;i++){mp[i*3]=Math.random()*2-1;mp[i*3+1]=Math.random()*2-1;mp[i*3+2]=Math.random()*2-1;ms[i]=14*(.4+Math.random());seed[i]=Math.random();}
const mg=new THREE.BufferGeometry();mg.setAttribute('position',new THREE.BufferAttribute(mp,3));mg.setAttribute('size',new THREE.BufferAttribute(ms,1));mg.setAttribute('seed',new THREE.BufferAttribute(seed,1));
const mm=new THREE.ShaderMaterial({transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false,uniforms:{uTime:{value:0},uColor:{value:vec('#ffd9a0')},uRes:{value:new THREE.Vector2(innerWidth*devicePixelRatio,innerHeight*devicePixelRatio)}},
vertexShader:`attribute float size;attribute float seed;uniform float uTime;uniform vec2 uRes;varying float vA;
vec3 warp(vec3 p,float t){float c=.9,a=1.9,b=.02,s=.05;p*=2.;p.x+=c*sin(s*t+a*p.y)+t*b;p.y+=c*cos(s*t+a*p.x);p.y+=c*sin(s*t+a*p.z)+t*b;p.z+=c*cos(s*t+a*p.y);p.z+=c*sin(s*t+a*p.x)+t*b;p.x+=c*cos(s*t+a*p.z);return cos(p+vec3(1,2,4));}
void main(){vec3 v=position*4.+warp(position,uTime)*1.2;vec4 mv=modelViewMatrix*vec4(v,1.);float r=length(v);float farF=1.-smoothstep(5.,6.5,r);float nearF=smoothstep(0.,.5,-mv.z);vA=farF*nearF;gl_PointSize=max(size*uRes.y/900./-mv.z,1.);gl_Position=projectionMatrix*mv;}`,
fragmentShader:`uniform vec3 uColor;varying float vA;void main(){vec2 p=gl_PointCoord-.5;float l=length(p);if(l>.5)discard;float tex=smoothstep(.5,0.,l);gl_FragColor=vec4(uColor*tex,tex*vA*.55);}`});
const motes=new THREE.Points(mg,mm);motes.frustumCulled=false;motes.layers.set(LAYERS.ENTIRE_SCENE);scene.add(motes);
const finalDef={uniforms:{iTime:{value:0},tDiffuse:{value:null},bloomTexture:{value:null},torusTexture:{value:null},haloTexture:{value:null},iCornerBlue:{value:vec('#ffcf2a')},iCornerOrange:{value:vec('#ff3b1f')}},
vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`,
fragmentShader:`uniform float iTime;uniform sampler2D tDiffuse;uniform sampler2D bloomTexture;uniform sampler2D torusTexture;uniform sampler2D haloTexture;uniform vec3 iCornerBlue;uniform vec3 iCornerOrange;varying vec2 vUv;
vec3 warp3d(vec3 pos,float t){float curv=.8,a=1.9,b=.7;pos*=2.;pos.x+=curv*sin(t+a*pos.y)+t*b;pos.y+=curv*cos(t+a*pos.x);pos.y+=curv*sin(t+a*pos.z)+t*b;pos.z+=curv*cos(t+a*pos.y);pos.z+=curv*sin(t+a*pos.x)+t*b;pos.x+=curv*cos(t+a*pos.z);return .5+.5*cos(pos.xyz+vec3(1,2,4));}
void main(){vec2 uv=2.*vUv-1.;vec3 w=pow(warp3d(vec3(uv.x,sin(uv.y),uv.y),iTime*1.5),vec3(1.5));vec3 col=1.5*iCornerBlue*w.x;col*=w.y;col+=iCornerOrange*w.z;col*=smoothstep(.6,1.,abs(uv.y));col*=smoothstep(-.5,1.,-uv.y*uv.x);col*=smoothstep(-.5,1.,-uv.y*uv.x);vec3 halo=texture2D(haloTexture,vUv).xyz;vec3 atmoBg=vec3(.02,.03,.10)*(1.-.4*length(uv));gl_FragColor=vec4(atmoBg+col*.34+texture2D(bloomTexture,vUv).xyz+texture2D(torusTexture,vUv).xyz+texture2D(tDiffuse,vUv).xyz+halo,1.);}`};
const renderScene=new RenderPass(scene,camera);
const torusComposer=new EffectComposer(renderer);torusComposer.renderToScreen=false;torusComposer.addPass(renderScene);torusComposer.addPass(new ShaderPass(GammaCorrectionShader));torusComposer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.22,.2,0));torusComposer.addPass(new ShaderPass(CopyShader));
const bloomComposer=new EffectComposer(renderer);bloomComposer.renderToScreen=false;bloomComposer.addPass(renderScene);bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.35,.5,0));bloomComposer.addPass(new ShaderPass(GammaCorrectionShader));
const finalComposer=new EffectComposer(renderer),finalPass=new ShaderPass(finalDef);finalPass.uniforms.bloomTexture.value=bloomComposer.renderTarget1.texture;finalPass.uniforms.torusTexture.value=torusComposer.renderTarget1.texture;finalComposer.addPass(renderScene);finalComposer.addPass(finalPass);
const start=performance.now();let lastT=start/1000,scrollTarget=0,scrollCurrent=0;
function updateScroll(){const max=document.documentElement.scrollHeight-innerHeight;scrollTarget=clamp(max>0?scrollY/max:0,0,1);}
addEventListener('scroll',updateScroll,{passive:true});
motes.onBeforeRender=()=>{const t=performance.now()/1000;mm.uniforms.uTime.value=t*.8*8;motes.position.copy(camera.position);finalPass.uniforms.iTime.value=t;};
function render(){requestAnimationFrame(render);const now=performance.now(),t=now/1000,dt=Math.min(.05,t-lastT);lastT=t;scrollCurrent+=(scrollTarget-scrollCurrent)*.08;camera.position.z=14-scrollCurrent*4;
const appear=clamp((now-start)/2000,0,1),smooth=appear*appear*(3-2*appear),slide=clamp((now-start-500)/1500,0,1),ease=1-Math.pow(1-slide,4);
group.visible=true;group.position.z=-20+20*ease;uniforms.iAnimate.value=smooth;uniforms.uOpacity.value=ease;uniforms.iTime.value=t;uniforms.uExpand.value=1+scrollCurrent;
const spin=.2*(1+scrollCurrent*2.62)*dt;cloud.rotation.y+=spin;cloud.rotation.x+=spin*.35;
if(appear>=1){uniforms.iAnimate.value=1;uniforms.uOpacity.value=1;group.position.z=0;}
finalPass.uniforms.iTime.value=t;camera.layers.set(1);torusComposer.render();camera.layers.set(2);bloomComposer.render();camera.layers.set(3);finalComposer.render();}
updateScroll();render();
addEventListener('resize',()=>{const w=innerWidth,h=innerHeight,dpr=devicePixelRatio;renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();for(const c of [torusComposer,bloomComposer,finalComposer]){c.setPixelRatio(dpr);c.setSize(w,h);}mm.uniforms.uRes.value.set(w*dpr,h*dpr);updateScroll();});

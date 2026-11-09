import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const banned=[/iframe_api/i,/youtube(?:-nocookie)?\.com\/embed\//i,/<iframe(?:\s|>)/i,/YouTubePlayer/,/onYouTubeIframeAPIReady/,/connectYouTube/,/engine\s*[:=]+\s*['"]youtube['"]/];
function check(dir){
  for(const file of readdirSync(dir,{withFileTypes:true})){
    if(file.name==='__tests__')continue;
    const path=join(dir,file.name);
    if(file.isDirectory())check(path);
    else if(/\.(tsx?|js|html|css)$/.test(path)){
      const text=readFileSync(path,'utf8');
      for(const pattern of banned)if(pattern.test(text))throw new Error(`Removed playback path found in ${path}: ${pattern}`);
    }
  }
}
check('frontend/src');
if(existsSync('dist'))check('dist');
console.log('MP3-only playback: no YouTube embed/API/engine in source or built assets');

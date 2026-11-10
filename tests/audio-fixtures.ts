// Original PCM tones: decoded media for persistence/playback tests, not YouTube service evidence.
export function tone(index: number, seconds = 6) {
 const rate=22050, count=rate*seconds, buffer=Buffer.alloc(44+count*2);
 buffer.write("RIFF",0);buffer.writeUInt32LE(36+count*2,4);buffer.write("WAVEfmt ",8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write("data",36);buffer.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++)buffer.writeInt16LE(Math.round(5000*Math.sin(2*Math.PI*(220+index*70)*i/rate)),44+i*2);
 return {name:`TestArtist - Offline ${index+1}.wav`,mimeType:"audio/wav",buffer};
}

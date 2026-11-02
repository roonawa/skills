import {deflateRawSync} from 'node:zlib';
function crc32(data){let n=0xffffffff;for(const byte of data){n^=byte;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
export function zipFiles(files){
 const parts=[],central=[],seen=new Set();let offset=0,total=0;
 if(files.length>65535)throw Error('ZIPのファイル数が上限を超えています');
 for(const {name,data:input} of files){
  if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(name))throw Error('ZIP内のファイル名が不正です');seen.add(name);
  const filename=Buffer.from(name),data=Buffer.from(input);total+=data.length;
  if(total>256*1024*1024)throw Error('ZIP対象が256MBを超えています。個別の報告書をダウンロードしてください');
  const packed=deflateRawSync(data),crc=crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);header.copy(entry,6,4,30);entry.writeUInt32LE(offset,42);central.push(entry,filename);parts.push(header,filename,packed);offset+=header.length+filename.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);
}

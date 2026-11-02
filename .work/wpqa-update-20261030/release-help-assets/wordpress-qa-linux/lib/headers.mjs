export function scopedHeaders(headers,configured,url,baseURL) {
  const result={...headers};
  if(new URL(url).origin!==new URL(baseURL).origin) {
    const privateKeys=new Set(Object.keys(configured).map(k=>k.toLowerCase()));
    for(const key of Object.keys(result)) if(privateKeys.has(key.toLowerCase())) delete result[key];
  }
  return result;
}

(function(){
  const COUNT_API_NAMESPACE='cshub-global-v1';
  const DEFAULT_REMOTE_BASE='https://explicabler-github-io.onrender.com';

  function normalizeBase(url){
    if(!url) return '';
    return String(url).trim().replace(/\/+$/,'');
  }

  function getBaseUrl(){
    const override = normalizeBase(localStorage.getItem('cshub_backend_url'));
    if(override) return override;
    if(window.CSHUB_BACKEND_URL) return normalizeBase(window.CSHUB_BACKEND_URL);
    return DEFAULT_REMOTE_BASE;
  }

  async function requestRemote(path, options){
    const base=getBaseUrl();
    if(!base) return null;
    try{
      const res=await fetch(base+path, options);
      if(!res.ok) return null;
      return await res.json();
    }catch(e){
      return null;
    }
  }

  async function getStat(key){
    const remote=await requestRemote('/api/stats/get?key='+encodeURIComponent(key));
    if(remote && typeof remote.value==='number') return remote.value;

    try{
      const r=await fetch('https://api.countapi.xyz/get/'+COUNT_API_NAMESPACE+'/'+key);
      const d=await r.json();
      return typeof d.value==='number'?d.value:0;
    }catch(e){
      return 0;
    }
  }

  async function updateStat(key,amount){
    const remote=await requestRemote('/api/stats/update',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,amount})
    });
    if(remote && typeof remote.value==='number') return remote.value;

    try{
      const r=await fetch('https://api.countapi.xyz/update/'+COUNT_API_NAMESPACE+'/'+key+'?amount='+amount);
      const d=await r.json();
      return typeof d.value==='number'?d.value:0;
    }catch(e){
      return 0;
    }
  }

  async function submitSuggestion(payload){
    const remote=await requestRemote('/api/suggestions',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    return !!(remote && (remote.ok===true || remote.id));
  }

  window.CSHubBackend={
    getBaseUrl,
    getStat,
    updateStat,
    submitSuggestion
  };
})();

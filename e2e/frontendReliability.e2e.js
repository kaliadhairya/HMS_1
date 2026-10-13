const { chromium, browserAs, runner, assert, BASE } = require('./helpers');
(async()=>{
 const {step,done}=runner('Frontend reliability');const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  await step('503 preserves the current screen and unsaved patient draft',async()=>{
   const {ctx,page}=await browserAs(browser,'receptionist');
   try {
    await page.goto(BASE+'/hms/patients/new');
    await page.getByRole('button',{name:'Begin general registration'}).click();
    await page.fill('#np-first-name','Unsaved synthetic draft');
    const before=page.url();
    await page.route('**/api/billing/advance',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'MAINTENANCE_READ_ONLY',message:'Clinical writes are temporarily unavailable.'})}));
    const status=await page.evaluate(async()=>{const {default:api}=await import('/src/api/axios.js');try {await api.post('/billing/advance',{});}catch(error){return error.response.status;}});
    assert(status===503,'503 fixture not received');
    assert(page.url()===before,'active screen was replaced');
    assert(await page.inputValue('#np-first-name')==='Unsaved synthetic draft','draft was lost');
   }finally{await ctx.close();}
  });
  await step('An uncertain command response retries with the original key',async()=>{
   const {ctx,page}=await browserAs(browser,'receptionist');const keys=[];
   try {
    await page.route('**/api/billing/advance',async(route)=>{
     keys.push(route.request().headers()['idempotency-key']);
     await route.fulfill({status:keys.length===1?503:200,contentType:'application/json',body:JSON.stringify(keys.length===1?{code:'RESPONSE_NOT_DURABLE'}:{success:true})});
    });
    const status=await page.evaluate(async()=>{const {default:api}=await import('/src/api/axios.js');return (await api.post('/billing/advance',{})).status;});
    assert(status===200 && keys.length===2 && keys[0]===keys[1],'ambiguous retry changed the command identity');
   }finally{await ctx.close();}
  });
 }finally{await browser.close();}
 done();process.exit(process.exitCode||0);
})();

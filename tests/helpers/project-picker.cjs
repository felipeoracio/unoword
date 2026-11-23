/** Both the preserved native-select baseline and shared Base UI picker. */
exports.projectValue=page=>page.getByRole('combobox',{name:'Active project',exact:true}).evaluate(el=>el.getAttribute('data-project-value')??el.value);
// Legacy suite name: writing now opens independently of AI project metadata.
exports.waitProject=(page,id)=>page.waitForFunction(id=>{
 const legacy=document.querySelector('[aria-label="Active project"]');
 if(legacy)return (legacy.getAttribute('data-project-value')??legacy.value)===id&&!legacy.disabled;
 if(id){const target=document.querySelector('select[aria-label="Suggestion project"]');return target?.value===id&&!target.disabled;}
 const canvas=document.querySelector('.uw-writing-canvas[contenteditable="true"]');
 const start=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Start New Document'&&!button.disabled);
 return !!(canvas||start);
},id);
exports.chooseProject=async(page,id,{wait=true}={})=>{
 if(!await page.getByRole('combobox',{name:'Active project',exact:true}).count()){
  const assistant=page.getByRole('button',{name:'Writing assistant',exact:true});if(await assistant.getAttribute('aria-expanded')!=='true')await assistant.click();
  await page.getByLabel('Suggestion project',{exact:true}).selectOption(id);if(wait)await exports.waitProject(page,id);return;
 }
 const trigger=page.getByRole('combobox',{name:'Active project',exact:true});
 if(await trigger.evaluate(el=>el.tagName==='SELECT'))await trigger.selectOption(id);
 else {await trigger.click();await page.locator(`[role="option"][data-project-id="${id}"]`).click();}
 if(wait)await exports.waitProject(page,id);
};

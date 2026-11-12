/** Both the preserved native-select baseline and shared Base UI picker. */
exports.projectValue=page=>page.getByRole('combobox',{name:'Active project',exact:true}).evaluate(el=>el.getAttribute('data-project-value')??el.value);
exports.waitProject=(page,id)=>page.waitForFunction(id=>{const el=document.querySelector('[aria-label="Active project"]');return el&&(el.getAttribute('data-project-value')??el.value)===id&&!el.disabled;},id);
exports.chooseProject=async(page,id,{wait=true}={})=>{
 const trigger=page.getByRole('combobox',{name:'Active project',exact:true});
 if(await trigger.evaluate(el=>el.tagName==='SELECT'))await trigger.selectOption(id);
 else {await trigger.click();await page.locator(`[role="option"][data-project-id="${id}"]`).click();}
 if(wait)await exports.waitProject(page,id);
};

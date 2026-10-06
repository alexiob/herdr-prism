import { readFileSync } from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('./protocol.json',import.meta.url),'utf8'));
const definitions=schema.schemas.request.$defs;
const methods=new Map<string,any>(schema.schemas.request.oneOf.map((b:any)=>[b.properties.method.const,b.properties.params]));
function validate(value:any, rule:any, at:string, depth=0):void {
  if(depth>64)throw new Error(`${at}: schema recursion limit`);
  if(rule.$ref){validate(value,definitions[rule.$ref.split('/').pop()],at,depth+1);return;}
  if(rule.anyOf||rule.oneOf){let matches=0;const errors:string[]=[];for(const child of rule.anyOf??rule.oneOf){try{validate(value,child,at,depth+1);matches++;}catch(e){errors.push((e as Error).message);}}if(!matches||(rule.oneOf&&matches!==1))throw new Error(`${at}: ${errors.join('; ')||'oneOf mismatch'}`);return;}
  if('const' in rule&&value!==rule.const)throw new Error(`${at}: expected ${rule.const}`);
  if(rule.enum&&!rule.enum.includes(value))throw new Error(`${at}: invalid enum`);
  if(rule.type){const types=Array.isArray(rule.type)?rule.type:[rule.type];const kind=value===null?'null':Array.isArray(value)?'array':typeof value;if(!types.some((t:string)=>t===kind||(t==='integer'&&typeof value==='number'&&Number.isSafeInteger(value))))throw new Error(`${at}: expected ${types}`);}
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error(`${at}: finite number required`);if(rule.minimum!==undefined&&value<rule.minimum)throw new Error(`${at}: minimum`);if(rule.maximum!==undefined&&value>rule.maximum)throw new Error(`${at}: maximum`);}
  if(typeof value==='string'&&rule.pattern&&!new RegExp(rule.pattern).test(value))throw new Error(`${at}: pattern mismatch`);
  if(Array.isArray(value)){if(rule.maxItems&&value.length>rule.maxItems)throw new Error(`${at}: maxItems`);if(rule.items)value.forEach((v,i)=>validate(v,rule.items,`${at}[${i}]`,depth+1));}
  else if(value&&typeof value==='object'){
    if(rule.maxProperties&&Object.keys(value).length>rule.maxProperties)throw new Error(`${at}: maxProperties`);
    for(const name of rule.required??[])if(!(name in value))throw new Error(`${at}: missing ${name}`);
    for(const [name,v]of Object.entries(value)){
      if(rule.propertyNames)validate(name,rule.propertyNames,`${at}: property ${name}`,depth+1);
      if(rule.properties?.[name])validate(v,rule.properties[name],`${at}.${name}`,depth+1);
      else if(rule.additionalProperties&&typeof rule.additionalProperties==='object')validate(v,rule.additionalProperties,`${at}.${name}`,depth+1);
      else if(rule.additionalProperties===false)throw new Error(`${at}: unknown ${name}`);
    }
  }
}
export function validateRequest(method:string,params:Record<string,unknown>):void {const rule=methods.get(method);if(!rule)throw new Error(`Unsupported Herdr method: ${method}`);validate(params,rule,method);}
export function supportedMethods():string[]{return [...methods.keys()];}

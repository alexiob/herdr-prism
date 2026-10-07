import type {SessionView} from './types.ts';
/** Human label; exact session IDs remain available in identity details. */
export function sessionName(session?:SessionView):string {
 if(!session)return 'Agent unavailable';
 const title=session.evidence.title?.trim();
 const opaque=/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{16,}|pane-.+)$/i;
 if(title&&(title!==session.evidence.id||!opaque.test(title)))return title;
 const attachment=session.attachment??session.attachments?.[0];
 if(attachment?.name?.trim())return attachment.name.trim();
 const provider=session.evidence.provider,kind=session.parentKey||session.evidence.parentId?'worker':'session';
 return `${provider.charAt(0).toUpperCase()+provider.slice(1)} ${kind}`;
}

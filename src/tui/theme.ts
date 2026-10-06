export type ThemeName = 'dark' | 'light' | 'mono';
export type ColorRole = 'text' | 'secondary' | 'border' | 'accent' | 'quantity' | 'duration' | 'identity' | 'path' | 'positive' | 'warning' | 'negative';
export interface TextSpan {text:string;role:ColorRole;selected?:boolean;}
const palettes:Record<Exclude<ThemeName,'mono'>,Record<ColorRole,string>&{selection:string}>={
  dark:{text:'#D7DEE7',secondary:'#9AA8BA',border:'#526074',accent:'#70C9D5',quantity:'#8AC8F5',duration:'#D9BD84',identity:'#C6ABDD',path:'#AAD0CF',positive:'#8DC98A',warning:'#E6BF74',negative:'#E58B88',selection:'#243746'},
  light:{text:'#202938',secondary:'#566579',border:'#A8B3C2',accent:'#006879',quantity:'#205A8A',duration:'#795900',identity:'#6F408D',path:'#245F65',positive:'#256A38',warning:'#805800',negative:'#A52D38',selection:'#D9EAF0'},
};
const basic:Record<ColorRole,number>={text:39,secondary:37,border:90,accent:36,quantity:36,duration:33,identity:35,path:34,positive:32,warning:33,negative:31};
function rgb(hex:string):number[]{return [1,3,5].map(i=>Number.parseInt(hex.slice(i,i+2),16));}
/** Color never carries meaning without the accompanying text/glyph. */
export function styleSpans(spans:TextSpan[],options:{theme?:ThemeName;color?:boolean;depth?:4|8|24}={}):string{
  const {theme='dark',color=true,depth=24}=options;
  if(!color||theme==='mono')return spans.map(span=>span.text).join('');
  return spans.map(span=>{
    const color=rgb(palettes[theme][span.role]);
    const foreground=depth===24?`38;2;${color.join(';')}`:depth===8?`38;5;${16+36*Math.round(color[0]!/51)+6*Math.round(color[1]!/51)+Math.round(color[2]!/51)}`:String(basic[span.role]);
    const background=span.selected?(depth===24?`;48;2;${rgb(palettes[theme].selection).join(';')}`:';7'):'';
    return `\x1b[${foreground}${background}m${span.text}\x1b[0m`;
  }).join('');
}

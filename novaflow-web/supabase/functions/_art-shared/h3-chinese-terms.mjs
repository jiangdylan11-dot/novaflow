// Models translate Chinese names and style words however the prompt asks them not to,
// and H3 draws what the English says (青衫 became a bright cyan robe, 李逍遥 a girl).
// The words the user wrote go back into the English text here. Only a term the user
// actually wrote is touched; everything else stays as the model wrote it.
const TERMS=Object.freeze([
  ['青衫',/\b(?:(?:dark |light |pale |deep )?(?:cyan|teal|azure|turquoise|green|blue-green|blue green|gr[ae]y-blue|gr[ae]y blue|indigo|bluish|greenish)[- ])(?:robes?|gowns?|tunics?|garments?|shirts?|clothes|clothing|attire|cloaks?)\b/gi],
  ['国风',/\b(?:traditional )?Chinese[- ]style\b|\bChinese national style\b|\bguofeng\b/gi],
  ['汉服',/\bhanfu\b|\bHan[- ]style (?:clothing|dress|attire)\b|\btraditional Chinese (?:clothing|dress|attire|costume)\b/gi],
  ['旗袍',/\bqipao\b|\bcheongsam\b/gi],
  ['唐装',/\btang (?:suit|jacket)\b/gi],
  ['道袍',/\b(?:tao|dao)ist robes?\b/gi]
]);
const SURNAMES=Object.freeze({李:'li',王:'wang',张:'zhang',刘:'liu',陈:'chen',杨:'yang',黄:'huang',赵:'zhao',吴:'wu',周:'zhou',徐:'xu',孙:'sun',马:'ma',朱:'zhu',胡:'hu',郭:'guo',何:'he',林:'lin',罗:'luo',高:'gao',郑:'zheng',梁:'liang',谢:'xie',宋:'song',唐:'tang',韩:'han',冯:'feng',邓:'deng',曹:'cao',彭:'peng',曾:'zeng',肖:'xiao',田:'tian',董:'dong',潘:'pan',袁:'yuan',蔡:'cai',蒋:'jiang',余:'yu',于:'yu',杜:'du',叶:'ye',程:'cheng',魏:'wei',苏:'su',吕:'lv',丁:'ding',任:'ren',卢:'lu',姚:'yao',沈:'shen',钟:'zhong',姜:'jiang',崔:'cui',谭:'tan',陆:'lu',范:'fan',汪:'wang',廖:'liao',石:'shi',金:'jin',韦:'wei',贾:'jia',夏:'xia',方:'fang',白:'bai',邹:'zou',孟:'meng',熊:'xiong',秦:'qin',邱:'qiu',江:'jiang',尹:'yin',薛:'xue',段:'duan',雷:'lei',侯:'hou',龙:'long',史:'shi',陶:'tao',贺:'he',顾:'gu',毛:'mao',郝:'hao',龚:'gong',邵:'shao',钱:'qian',严:'yan',洪:'hong',武:'wu',莫:'mo',孔:'kong',欧阳:'ouyang',司马:'sima',上官:'shangguan',慕容:'murong',令狐:'linghu',诸葛:'zhuge',东方:'dongfang',独孤:'dugu'});
const SYLLABLE=/(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ang|eng|ing|ong|ian|iao|uai|uan|ai|ei|ao|ou|an|en|er|ia|ie|in|iu|ua|uo|ui|un|a|e|i|o|u|v)/g;
const syllables=word=>(word.toLowerCase().match(SYLLABLE)||[]).length;

function restoreNames(english,source) {
  return english.replace(/\b([A-Z][a-z]+)[ -]([A-Z][a-z]+)\b/g,(all,family,given)=>{
    const count=syllables(given);if(!count||count>2)return all;
    for(const [surname,sound] of Object.entries(SURNAMES)){
      if(sound!==family.toLowerCase())continue;
      const found=new RegExp(surname+'[\\u4e00-\\u9fff]{'+count+'}').exec(source);
      if(found)return found[0];
    }
    return all;
  });
}
export function restoreChineseTerms(english,source) {
  const text=String(english||''),from=String(source||'');
  if(!text||!/[一-鿿]/.test(from))return text;
  let out=restoreNames(text,from);
  for(const [term,pattern] of TERMS)if(from.includes(term))out=out.replace(pattern,term);
  if(from.includes('国风'))out=out.replace(/\bChinese wuxia\b/gi,'国风 wuxia');
  return out;
}

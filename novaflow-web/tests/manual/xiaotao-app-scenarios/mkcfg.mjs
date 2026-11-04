import {normalizeCreditConfig} from '../../../packages/shared/src/feature-credits.mjs';
const flags=Object.fromEntries('operation_art_v3 operation_audio_rewrite_v3 operation_foart_general_v3 operation_foart_open_v3 operation_style_v3 operation_text_chat_v3 operation_ui_draft_v3 operation_video_rewrite_v3 operation_vision_chat_v3'.split(' ').map(k=>[k,true]));
const want={billing_scope:'operation',credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0,...flags};
let c=normalizeCreditConfig({xiaotao_online:want});
Object.assign(c.xiaotao_online,want);
console.log(JSON.stringify(c));

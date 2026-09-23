const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPacket}=require('../scripts/build-creator-ai-handoff');

test('only complete source text enters the AI packet, while other works remain in the manifest',()=>{
  const transcript='保偏光纤用于光引擎的激光传输。保偏光纤用于光引擎的激光传输。';
  const docs=[
    {id:1,mediaType:'video',status:'complete',transcript,title:'完整视频',sourceUrl:'https://www.douyin.com/video/1',publishedAt:'2026-09-18',model:'small'},
    {id:2,mediaType:'video',status:'needs_review',transcript,title:'待复核视频'},
    {id:3,mediaType:'note',status:'ocr_not_collected',transcript:'',title:'图文'},
    {id:4,mediaType:'video',status:'complete',transcript:'这段看似正常的文字实际由上游审计标记为提示词回声，必须隔离。'.repeat(2),
      title:'疑似提示词',promptSuspect:true}
  ];
  const packet=buildPacket({documents:docs},'Fioona');
  assert.equal(packet.ready.length,1);
  assert.equal(packet.ready[0].observationId,1);
  assert.equal(packet.ready[0].text,transcript);
  assert.match(packet.ready[0].bodyHash,/^[a-f0-9]{64}$/);
  assert.equal(packet.ready[0].automaticTrading,false);
  assert.equal(packet.blocked.length,3);
  assert.deepEqual(packet.blocked.map(item=>item.reason),['asr_review_required','note_ocr_required','suspected_prompt_echo']);
  assert.equal(packet.blocked[0].text,undefined);
});

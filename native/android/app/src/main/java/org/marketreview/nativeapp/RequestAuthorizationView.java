package org.marketreview.nativeapp;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
public final class RequestAuthorizationView extends LinearLayout {
 private final RequestAuthorization lease=new RequestAuthorization();
 private final BooleanSupplier owner;private final EditText credential;private final CheckBox reviewed,model,billing;
 private final Spinner requests;private final TextView body;private TextView status;private final Handler timer=new Handler(Looper.getMainLooper());
 public Runnable changed,expired;private boolean internalEdit;
 private final Runnable tick=new Runnable(){public void run(){long d=lease.deadline();if(d!=0&&(System.currentTimeMillis()>=d||!owner.getAsBoolean())){clear();if(expired!=null)expired.run();}if(isAttachedToWindow())timer.postDelayed(this,250);}};
 public RequestAuthorizationView(Context c,BooleanSupplier active){
  super(c);owner=active;setOrientation(VERTICAL);setTag("requestAuthorization");setSaveEnabled(false);setSaveFromParentEnabled(false);setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
  label("当前请求的短期授权 · 默认无授权 / 无凭据",null);
  requests=new Spinner(c);requests.setTag("authorizationRequests");requests.setSaveEnabled(false);addView(requests);
  body=label("先生成精确请求，再逐项阅读。","authorizationExactBody");body.setTextIsSelectable(true);
  reviewed=check("已逐项核对完整待发送材料、服务方、端点、模型和摘要","authorizationReviewed");
  model=check("我确认本次账户可使用所选模型（尚未在线验证）","authorizationModel");
  billing=check("同意仅这些请求外发，并接受提供方可能计费","authorizationBilling");
  credential=new EditText(c);credential.setTag("authorizationCredential");credential.setSingleLine(true);credential.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);credential.setHint("主动输入本次 API 凭据；仅存内存，不保存");credential.setSaveEnabled(false);credential.setSaveFromParentEnabled(false);credential.setFreezesText(false);credential.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);addView(credential);
  button("授权当前请求列表 · 2分钟","authorizationApprove",()->{if(!isShown()||!owner.getAsBoolean())return;byte[] value=new byte[credential.length()<=4096?credential.length():0];try{if(credential.length()<16||credential.length()>4096)throw new Exception("credential-format-invalid");for(int i=0;i<value.length;i++){char ch=credential.getText().charAt(i);if(ch>127)throw new Exception("credential-format-invalid");value[i]=(byte)ch;}lease.approve(value,reviewed.isChecked(),model.isChecked(),billing.isChecked(),true,120000);status.setText("仅预览请求获得短期、逐次授权；仍需明确开始。");}catch(Exception e){lease.revoke();status.setText("授权未建立。请完成确认并输入有效的本次凭据。");}finally{Arrays.fill(value,(byte)0);internalEdit=true;credential.getText().clear();internalEdit=false;notifyChanged();}});
  for(CheckBox box:new CheckBox[]{reviewed,model,billing})box.setOnCheckedChangeListener((b,checked)->{if(!internalEdit&&!checked&&lease.deadline()!=0){clear();status.setText("确认已撤回；本次授权已撤销，请重新预览。");if(expired!=null)expired.run();}});
  credential.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void afterTextChanged(android.text.Editable e){}public void onTextChanged(CharSequence s,int start,int before,int count){if(!internalEdit&&lease.deadline()!=0){clear();status.setText("凭据已更改；旧授权已撤销，请重新预览再输入。");if(expired!=null)expired.run();}}});
  button("撤销授权","authorizationRevoke",()->{clear();if(expired!=null)expired.run();});status=label("请先生成并阅读精确请求。","authorizationStatus");
  requests.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?>p,View v,int n,long id){showRequest(n);}public void onNothingSelected(AdapterView<?>p){}});
 }
 private TextView label(String text,String tag){TextView v=new TextView(getContext()){@Override public boolean onPreDraw(){return !isShown()||getWidth()<=0||super.onPreDraw();}};v.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);v.setHyphenationFrequency(android.text.Layout.HYPHENATION_FREQUENCY_NONE);v.setText(text);if(tag!=null)v.setTag(tag);v.setSaveEnabled(false);addView(v,new LayoutParams(-1,-2));return v;}
 private CheckBox check(String text,String tag){CheckBox v=new CheckBox(getContext());v.setText(text);v.setTag(tag);v.setSaveEnabled(false);addView(v);return v;}
 private void button(String text,String tag,Runnable click){Button v=new Button(getContext());v.setText(text);v.setTag(tag);addView(v);v.setOnClickListener(x->click.run());}
 private void notifyChanged(){if(changed!=null)changed.run();}
 public void bind(List<AiKnowledgeRequest.Prepared> list)throws Exception{clear();lease.bind(list);List<String> names=new ArrayList<>();for(int i=0;i<list.size();i++)names.add("请求 "+(i+1)+" / "+list.size());requests.setAdapter(new ArrayAdapter<>(getContext(),android.R.layout.simple_spinner_dropdown_item,names));showRequest(0);status.setText("完整正文与摘要如下；请逐项审阅后主动授权。");notifyChanged();}
 public void clear(){internalEdit=true;lease.unbind();requests.setAdapter(null);body.setText("");credential.getText().clear();reviewed.setChecked(false);model.setChecked(false);billing.setChecked(false);status.setText("本次授权已撤销；凭据已清除。");internalEdit=false;notifyChanged();}
 public boolean ready(){return lease.ready();}
 public AiKnowledgeRequest.Grant authorize(AiKnowledgeRequest.Prepared p)throws Exception{return lease.authorize(p);}
 public byte[] acquire()throws Exception{return lease.acquire();}
 private void showRequest(int n){List<AiKnowledgeRequest.Prepared> rows=lease.review();if(n<0||n>=rows.size()){body.setText("");return;}try{AiKnowledgeRequest.Prepared r=rows.get(n);JSONObject p=r.preview();body.setText("服务方："+p.getString("provider")+"\n端点："+p.getString("endpoint")+"\n模型："+p.getString("model")+"\n预览摘要："+r.digest()+"\n请求正文 SHA256："+AiSettingsModel.hash(r.body())+"\nUTF-8 字节数："+r.body().length+"\n\n实际待发送的完整请求正文：\n"+new String(r.body(),java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){body.setText("请求无法显示；请重新预览。");clear();}}
 @Override protected void onAttachedToWindow(){super.onAttachedToWindow();timer.postDelayed(tick,250);}
 @Override protected void onDetachedFromWindow(){timer.removeCallbacks(tick);clear();super.onDetachedFromWindow();}
}

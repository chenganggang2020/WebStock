package org.marketreview.nativeapp;
import android.content.Context;
import android.widget.*;
import org.json.*;
import java.io.File;
public final class PaperPolicyScreen extends LinearLayout {
 public interface Host{JSONObject account()throws Exception;String now()throws Exception;}
 private final Host host;private final PaperPolicyStore store;private JSONObject shownAccount;private long revision=-1;
 private final Spinner state;private final EditText percent;private final CheckBox confirmed;private final TextView title,message;private final Button save;
 public PaperPolicyScreen(Context context,File file,Host host)throws Exception{
  super(context);this.host=host;store=new PaperPolicyStore(file);setOrientation(VERTICAL);int p=(int)(16*getResources().getDisplayMetrics().density);setPadding(p,p,p,p);
  title=new TextView(context);title.setText("纸面账户观察设置");addView(title);
  TextView info=new TextView(context);info.setText("请明确选择账户状态和单股权重上限。保存只影响纸面观察，不会生成订单或修改现金。");addView(info);
  state=new Spinner(context);state.setAdapter(new ArrayAdapter<String>(context,android.R.layout.simple_spinner_dropdown_item,new String[]{"请选择状态","观察中","暂停观察"}));addView(state);
  TextView weightLabel=new TextView(context);weightLabel.setText("单股权重上限（%）");addView(weightLabel);percent=new EditText(context);percent.setHint("0.0001 至 100");percent.setSingleLine(true);percent.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);addView(percent);
  confirmed=new CheckBox(context);confirmed.setText("我已核对目标纸面账户及上述设置");addView(confirmed);
  save=new Button(context);save.setText("保存设置");addView(save);Button reload=new Button(context);reload.setText("重读已保存设置");addView(reload);
  message=new TextView(context);addView(message);save.setOnClickListener(v->submit());reload.setOnClickListener(v->reload());reload();
 }
 private void reload(){
  save.setEnabled(false);confirmed.setChecked(false);state.setSelection(0);percent.setText("");revision=-1;
  try{
   shownAccount=new JSONObject(host.account().toString());PaperPolicySettings.binding(shownAccount);JSONObject a=store.read(),r=PaperPolicySettings.latest(a,shownAccount.getString("id"));revision=a.getLong("revision");
   title.setText("纸面账户："+shownAccount.getString("name")+"（"+shownAccount.getString("id")+"）");
   if(r.length()>0){state.setSelection(r.getString("status").equals("active")?1:2);percent.setText(java.math.BigDecimal.valueOf(r.getDouble("maxSingleWeight")).multiply(java.math.BigDecimal.valueOf(100)).stripTrailingZeros().toPlainString());}
   save.setEnabled(true);message.setText(r.length()==0?"尚未配置，纸面准备保持阻断。":"已读取保存版本，请核对后再保存。");
  }catch(Exception e){message.setText("设置读取失败或目标并非纸面账户；原文件保留。");}
 }
 private void submit(){
  if(!isShown()||!hasWindowFocus())return;
  try{
   PaperPolicySettings.need(revision>=0&&confirmed.isChecked()&&state.getSelectedItemPosition()>0,"required");String text=percent.getText().toString().trim();
   PaperPolicySettings.need(text.matches("(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)"),"weight");double limit=Double.parseDouble(text)/100.;
   JSONObject account=host.account();PaperPolicySettings.need(PortfolioMirrorModel.equal(PaperPolicySettings.binding(account),PaperPolicySettings.binding(shownAccount)),"identity");
   JSONObject saved=store.save(account,state.getSelectedItemPosition()==1?"active":"paused",limit,revision,host.now(),true);revision=saved.getLong("revision");confirmed.setChecked(false);
   message.setText("已保存版本 "+revision+"。后续准备和确认将重新读取此设置。");
  }catch(Exception e){message.setText("未保存：请核对账户、明确状态和有效比例；设置若已被其他入口修改，请先重读。");}
 }
}

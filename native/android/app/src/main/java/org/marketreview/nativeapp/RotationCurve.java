package org.marketreview.nativeapp;
import android.graphics.*;
import android.view.*;
import org.json.*;
import java.util.Locale;

/** Native Canvas: fixed continuous-session clock, distinct axes and visible gaps. */
final class RotationCurve extends View {
  final MainActivity owner;final Paint pen=new Paint(Paint.ANTI_ALIAS_FLAG);JSONArray data=new JSONArray();int selected=-1;
  RotationCurve(MainActivity a){super(a);owner=a;setTag("rotationCurve");setContentDescription("轮动历史曲线：模型净额亿元及板块涨跌幅百分比，点击或拖动查看抓取读数");}
  void values(JSONArray values){data=values;selected=-1;invalidate();}
  float dp(float n){return owner.dp(n);}
  double value(JSONObject p,int series){return series==0?(p.opt("cumulativeCents") instanceof String?Double.parseDouble(p.optString("cumulativeCents"))/1e10:Double.NaN):(p.opt("changeRatio") instanceof Number?p.optDouble("changeRatio")*100:Double.NaN);}
  void label(Canvas c,String s,float x,float y,int color){pen.setColor(color);pen.setStyle(Paint.Style.FILL);pen.setTextSize(dp(10));c.drawText(s,x,y,pen);}
  @Override protected void onDraw(Canvas c){
    int ink=owner.darkTheme()?Color.rgb(217,228,241):Color.rgb(38,54,74),grid=owner.darkTheme()?Color.rgb(55,73,93):Color.rgb(210,219,231);c.drawColor(owner.darkTheme()?Color.rgb(16,26,39):Color.WHITE);
    label(c,"累计模型净额（亿元，蓝） / 涨跌幅（%，橙）",dp(5),dp(18),ink);if(data.length()==0){label(c,"无盘中采样，日榜不能代替分钟曲线",dp(10),dp(65),ink);return;}
    float left=dp(49),right=getWidth()-dp(45),top=dp(63),bottom=getHeight()-dp(35);if(bottom<=top)return;
    for(int s=0;s<2;s++){
      double low=Double.POSITIVE_INFINITY,high=Double.NEGATIVE_INFINITY;for(int i=0;i<data.length();i++){double n=value(data.optJSONObject(i),s);if(Double.isFinite(n)){low=Math.min(low,n);high=Math.max(high,n);}}if(!Double.isFinite(low))continue;if(high-low<1e-9){high+=.01;low-=.01;}
      for(int i=0;i<3;i++){float y=top+(bottom-top)*i/2;pen.setColor(grid);pen.setStrokeWidth(dp(.5f));if(s==0)c.drawLine(left,y,right,y,pen);label(c,String.format(Locale.ROOT,"%.2f",high-(high-low)*i/2),s==0?dp(1):right+dp(3),y+dp(3),ink);}
      c.save();c.clipRect(left-2,top-2,right+2,bottom+2);float px=0,py=0;boolean have=false;pen.setColor(s==0?Color.rgb(52,125,222):Color.rgb(206,139,40));pen.setStrokeWidth(dp(1.3f));
      for(int i=0;i<data.length();i++){JSONObject p=data.optJSONObject(i);double n=value(p,s);if(!Double.isFinite(n)){have=false;continue;}float x=left+(right-left)*(float)(p.optDouble("tradingTimeMs")/(237*60000d)),y=bottom-(bottom-top)*(float)((n-low)/(high-low));if(have&&!p.optBoolean("gapBefore"))c.drawLine(px,py,x,y,pen);else c.drawCircle(x,y,dp(1.5f),pen);px=x;py=y;have=true;}c.restore();
    }
    label(c,"09:30",left-dp(13),bottom+dp(19),ink);label(c,"11:30/13:00",left+(right-left)*120/237-dp(29),bottom+dp(19),ink);label(c,"14:57",right-dp(25),bottom+dp(19),ink);
    if(selected>=0&&selected<data.length()){JSONObject p=data.optJSONObject(selected);float x=left+(right-left)*(float)(p.optDouble("tradingTimeMs")/(237*60000d));pen.setColor(grid);c.drawLine(x,top,x,bottom,pen);String a=Double.isFinite(value(p,0))?String.format(Locale.ROOT,"%.3f",value(p,0)):"—",b=Double.isFinite(value(p,1))?String.format(Locale.ROOT,"%.2f",value(p,1)):"—";String text=RotationScreen.local(p.optString("at"))+" 抓取";label(c,text,dp(5),dp(36),ink);label(c,"净额 "+a+" 亿 · 涨跌 "+b+"%",dp(5),dp(52),ink);setContentDescription(text+"，净额"+a+"亿元，涨跌"+b+"百分比");}
  }
  @Override public boolean onTouchEvent(MotionEvent e){if(e.getAction()==MotionEvent.ACTION_DOWN||e.getAction()==MotionEvent.ACTION_MOVE){double target=(e.getX()-dp(49))/Math.max(1,getWidth()-dp(94))*237*60000,best=Double.POSITIVE_INFINITY;for(int i=0;i<data.length();i++){double d=Math.abs(data.optJSONObject(i).optDouble("tradingTimeMs")-target);if(d<best){best=d;selected=i;}}invalidate();return true;}if(e.getAction()==MotionEvent.ACTION_UP){performClick();return true;}return super.onTouchEvent(e);}
  @Override public boolean performClick(){super.performClick();return true;}
}

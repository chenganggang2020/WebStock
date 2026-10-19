package org.marketreview.nativeapp;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/** Old chart formulas on valid input; explicit native-gap-v1 safety boundaries. */
public final class LegacyIndicators {
  private LegacyIndicators() {}
  static double fixed(double value,int digits) {
    if(!Double.isFinite(value))return Double.NaN;
    if(value==0||Math.abs(value)>=1e21)return value;
    // valueOf uses a shortest decimal, which is not the binary input used by JS toFixed.
    double result=new BigDecimal(value).setScale(digits,RoundingMode.HALF_UP).doubleValue();
    return result==0?Math.copySign(0.0,value):result;
  }
  public static final class Kdj {
    public final double[] k,d,j;
    public final boolean[] ready;
    Kdj(int count){k=Engine.missing(count);d=Engine.missing(count);j=Engine.missing(count);ready=new boolean[count];}
  }
  public static Kdj kdj(List<Engine.Bar> bars,int n) {
    Engine.period(n);Kdj out=new Kdj(bars.size());double[] prices=Engine.closes(bars);
    int start=0;double previousK=50,previousD=50;
    for(int i=0;i<bars.size();i++) {
      if(!Double.isFinite(prices[i])){start=i+1;continue;}
      boolean ready=i-start+1>=n;double rsv=50;
      if(ready){double low=bars.get(i).low,high=bars.get(i).high;
        for(int j=i+1-n;j<=i;j++){low=Math.min(low,bars.get(j).low);high=Math.max(high,bars.get(j).high);}
        if(high!=low)rsv=fixed(((prices[i]-low)/(high-low))*100,2);
      }
      double k=i==start?50:fixed(rsv*(1.0/3)+previousK*(2.0/3),2),
          d=i==start?50:fixed(k*(1.0/3)+previousD*(2.0/3),2),j=fixed(3*k-2*d,2);
      if(!Double.isFinite(k)||!Double.isFinite(d)||!Double.isFinite(j)){start=i+1;continue;}
      out.k[i]=previousK=k;out.d[i]=previousD=d;out.j[i]=j;out.ready[i]=ready;
    }
    return out;
  }
  public static double[] rsi(List<Engine.Bar> bars,int n) {
    Engine.period(n);double[] prices=Engine.closes(bars),out=Engine.missing(bars.size()),
        gains=new double[bars.size()],losses=new double[bars.size()];int start=0;
    for(int i=0;i<bars.size();i++) {
      if(!Double.isFinite(prices[i])){start=i+1;continue;}
      double change=i==start?0:prices[i]-prices[i-1];
      gains[i]=Math.max(change,0);losses[i]=Math.max(-change,0);
      if(i-start+1<n)continue;
      double gain=0,loss=0;
      for(int j=i+1-n;j<=i;j++){gain+=gains[j];loss+=losses[j];}
      if(!Double.isFinite(gain)||!Double.isFinite(loss)){start=i+1;continue;}
      double avgGain=gain/n,avgLoss=loss/n,value=avgLoss==0?100:fixed((avgGain/(avgGain+avgLoss))*100,2);
      if(!Double.isFinite(value)){start=i+1;continue;}
      out[i]=value;
    }
    return out;
  }
  public static double[] cci(List<Engine.Bar> bars,int n) {
    Engine.period(n);double[] prices=Engine.closes(bars),out=Engine.missing(bars.size()),tp=Engine.missing(bars.size());int start=0;
    for(int i=0;i<bars.size();i++) {
      if(!Double.isFinite(prices[i])){start=i+1;continue;}
      Engine.Bar bar=bars.get(i);tp[i]=fixed((bar.high+bar.low+bar.close)/3,4);
      if(!Double.isFinite(tp[i])){start=i+1;continue;}
      if(i-start+1<n)continue;
      double sum=0;for(int j=i+1-n;j<=i;j++)sum+=tp[j];
      double mean=fixed(sum/n,4);
      if(!Double.isFinite(mean)){start=i+1;continue;}
      double deviation=0;for(int j=i+1-n;j<=i;j++)deviation+=Math.abs(tp[j]-mean);
      double md=fixed(deviation/n,4),value=md==0?0:fixed((tp[i]-mean)/(0.015*md),2);
      if(!Double.isFinite(value)){start=i+1;continue;}
      out[i]=value;
    }
    return out;
  }
  public static double[] obv(List<Engine.Bar> bars) {
    double[] prices=Engine.closes(bars),out=Engine.missing(bars.size());boolean first=true;double value=0;
    for(int i=0;i<bars.size();i++) {
      double volume=bars.get(i).volume;
      if(!Double.isFinite(prices[i])||!Double.isFinite(volume)||volume<0){first=true;continue;}
      if(first)value=volume;
      else if(prices[i]>prices[i-1])value+=volume;
      else if(prices[i]<prices[i-1])value-=volume;
      if(!Double.isFinite(value)){first=true;continue;}
      out[i]=value;first=false;
    }
    return out;
  }
}

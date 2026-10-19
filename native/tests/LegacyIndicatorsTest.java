import java.nio.file.*;
import java.util.*;
import org.marketreview.nativeapp.Engine;
import org.marketreview.nativeapp.LegacyIndicators;

/** Both platforms consume the same old-JavaScript oracle, never each other's outputs. */
public final class LegacyIndicatorsTest {
  static int checks;
  static double n(String s){return s.equals("null")?Double.NaN:Double.parseDouble(s);}
  static void near(double actual,double expected,String label){
    checks++;
    if(!(Double.isNaN(actual)&&Double.isNaN(expected))&&!(Math.abs(actual-expected)<=1e-8))
      throw new AssertionError(label+" got="+actual+" expected="+expected);
  }
  static void run(List<String[]> rows){
    if(rows.isEmpty())return;
    List<Engine.Bar> bars=new ArrayList<>();
    for(String[] r:rows)bars.add(new Engine.Bar(n(r[6]),n(r[7]),n(r[8]),n(r[9]),n(r[10]),n(r[11]),r[12].equals("1"),r[13].equals("1")));
    int k=Integer.parseInt(rows.get(0)[2]),r=Integer.parseInt(rows.get(0)[3]),c=Integer.parseInt(rows.get(0)[4]);
    LegacyIndicators.Kdj kd=LegacyIndicators.kdj(bars,k);
    double[] rs=LegacyIndicators.rsi(bars,r),cc=LegacyIndicators.cci(bars,c),ob=LegacyIndicators.obv(bars);
    for(int i=0;i<rows.size();i++){
      String[] row=rows.get(i);String label=row[0]+":"+i;
      double[] got={kd.k[i],kd.d[i],kd.j[i],rs[i],cc[i],ob[i],kd.ready[i]?1:0};
      for(int j=0;j<got.length;j++)near(got[j],n(row[14+j]),label+" field "+j);
      List<Engine.Bar> prefix=bars.subList(0,i+1);
      LegacyIndicators.Kdj cut=LegacyIndicators.kdj(prefix,k);
      double[] before={cut.k[i],cut.d[i],cut.j[i],LegacyIndicators.rsi(prefix,r)[i],
          LegacyIndicators.cci(prefix,c)[i],LegacyIndicators.obv(prefix)[i],cut.ready[i]?1:0};
      for(int j=0;j<got.length;j++)near(before[j],got[j],label+" no future "+j);
    }
  }
  public static void main(String[] args)throws Exception{
    List<String[]> group=new ArrayList<>();String current="";int cases=0,rows=0;
    for(String line:Files.readAllLines(Path.of(args[0],"legacy-indicators.csv"))){
      if(line.isBlank()||line.startsWith("case,"))continue;
      String[] fields=line.split(",",-1);
      if(!fields[0].equals(current)){run(group);group.clear();current=fields[0];cases++;}
      group.add(fields);rows++;
    }
    run(group);
    for(int bad:new int[]{0,-1,501})for(int indicator=0;indicator<3;indicator++){
      boolean failed=false;
      try{if(indicator==0)LegacyIndicators.kdj(Collections.emptyList(),bad);
          else if(indicator==1)LegacyIndicators.rsi(Collections.emptyList(),bad);
          else LegacyIndicators.cci(Collections.emptyList(),bad);}
      catch(IllegalArgumentException expected){failed=true;}
      checks++;if(!failed)throw new AssertionError("invalid period accepted");
    }
    System.out.println("PASS Java legacy indicators: "+rows+" shared rows / "+cases+" cases / "+checks+" checks");
  }
}

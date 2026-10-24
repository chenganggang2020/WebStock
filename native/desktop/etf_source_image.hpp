#pragma once
#include <QImage>
#include <QLabel>
#include <QResizeEvent>
#include <QVector>

// Display source pixels, never OCR-derived numbers. Split only a recognized pair
// of complete framed tables; an unfamiliar layout keeps the entire original.
inline QVector<QRect> etfSourcePanels(const QImage& image){
 const int w=image.width(),h=image.height();if(w<300||h<600)return {};
 auto bands=[&](int kind){QVector<QPair<int,int>> found;int start=-1,last=-1;
  for(int y=0;y<h;++y){int hits=0,n=0;for(int x=w*8/100;x<w*92/100;x+=4){auto c=image.pixelColor(x,y);++n;bool match=kind==0?c.red()>110&&c.red()>c.green()*1.8&&c.red()>c.blue()*1.5:c.blue()>60&&c.blue()>c.red()*1.8&&c.blue()>c.green()*1.15;if(match)++hits;}
   if(hits>n*.62){if(start<0)start=y;last=y;}else if(start>=0&&y-last>w/40){if(last-start>w/40)found.append({start,last});start=-1;}}
  if(start>=0&&last-start>w/40)found.append({start,last});return found;};
 const auto red=bands(0),blue=bands(1);if(red.size()<2||blue.size()!=1)return {};const auto buy=red.last(),sell=blue[0];if(buy.second>=sell.first)return {};
 auto frame=[&](QPair<int,int> band,int limit){const int header=band.second-band.first+1;for(int y=band.second+header;y<limit;++y){int hits=0,n=0;for(int x=w*8/100;x<w*92/100;x+=4){auto c=image.pixelColor(x,y);++n;if(c.red()>240&&c.green()>150&&c.green()<225&&qAbs(c.green()-c.blue())<12)++hits;}if(hits>n*.7&&y-band.first>header*4&&y-band.first<header*25)return QRect(0,qMax(0,band.first-header),w,y-qMax(0,band.first-header)+3);}return QRect();};
 const auto a=frame(buy,sell.first),b=frame(sell,h);if(a.isEmpty()||b.isEmpty()||a.bottom()>=b.top())return {};return {a,b};
}
class EtfSourcePicture final:public QLabel{
 QPixmap original;
 void fit(){if(original.isNull())return;const auto scaled=original.scaledToWidth(qMax(120,width()),Qt::SmoothTransformation);setPixmap(scaled);setMinimumHeight(scaled.height());}
protected:void resizeEvent(QResizeEvent*event)override{QLabel::resizeEvent(event);fit();}
public:explicit EtfSourcePicture(QWidget*parent=nullptr):QLabel(parent){setAlignment(Qt::AlignTop|Qt::AlignHCenter);setMinimumWidth(120);setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Minimum);}
 void setSource(const QImage&image){original=QPixmap::fromImage(image);if(original.isNull()){clear();setMinimumHeight(0);}else fit();}
};

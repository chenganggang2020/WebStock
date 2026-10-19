#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QPointF>
class MarketComparisonPlot final:public QWidget {
 Q_OBJECT
 QJsonObject frame,pendingViewport;double first=0,span=0;QPointF pressed;double pressedFirst=0;bool dragging=false,autoFit=true;int hovered=-1;
 void clamp();
protected:
 void paintEvent(QPaintEvent*)override;
 void wheelEvent(QWheelEvent*)override;
 void mousePressEvent(QMouseEvent*)override;
 void mouseMoveEvent(QMouseEvent*)override;
 void mouseReleaseEvent(QMouseEvent*)override;
 void mouseDoubleClickEvent(QMouseEvent*)override;
 void leaveEvent(QEvent*)override;
public:
 explicit MarketComparisonPlot(QWidget*parent=nullptr);
 void setFrame(const QJsonObject&,bool preserveViewport=false);
 QJsonObject saveViewport()const;
 QJsonObject sourceFrame()const{return frame;}
 void restoreViewport(const QJsonObject&);
public slots:void resetViewport();
signals:void viewportChanged();
};

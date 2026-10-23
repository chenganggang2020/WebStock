#pragma once
#include <QWidget>
#include <QJsonArray>
#include <QRectF>
#include <functional>
class IndustryGraph final:public QWidget {
public:
 explicit IndustryGraph(QWidget* parent=nullptr);
 void setRows(const QJsonArray& rows);
 void setSelection(const QString& key);
 std::function<void(QString)> selected;
protected:void paintEvent(QPaintEvent*)override;void mousePressEvent(QMouseEvent*)override;
private:QJsonArray rows;QString selection;QList<QPair<QRectF,QString>> boxes;void arrange();
};

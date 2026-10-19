#pragma once
#include <QWidget>
#include <QJsonObject>
#include <memory>
class QNetworkAccessManager;
class GlobalMarketPage final:public QWidget {
 Q_OBJECT
public:
 explicit GlobalMarketPage(QString dataDirectory,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* borrowed=nullptr);
 ~GlobalMarketPage()override;
 QJsonObject sourceEvidence()const;
 QJsonObject saveState()const;
 void restoreState(const QJsonObject& state);
signals:
 void backRequested();
protected:
 void hideEvent(QHideEvent*)override;
 void showEvent(QShowEvent*)override;
private:
 struct Private;std::unique_ptr<Private> d;
};

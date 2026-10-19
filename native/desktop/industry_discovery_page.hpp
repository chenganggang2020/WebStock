#pragma once
#include <QWidget>
#include <QJsonObject>
#include <memory>
class QNetworkAccessManager;
class IndustryDiscoveryPage final:public QWidget {
 Q_OBJECT
 public:IndustryDiscoveryPage(QString dedicatedSqlite,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);~IndustryDiscoveryPage()override;
 QJsonObject saveState()const;void restoreState(const QJsonObject&);void setHostError(const QString&);void previewImport(const QByteArray&);QByteArray exportArchive()const;void setMaterialsAvailable(bool available);
 signals:void openBoard(QString provider,QString taxonomy,QString code);void openMaterials(QJsonObject topic);
 protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
 private:struct Private;std::unique_ptr<Private> d;
};

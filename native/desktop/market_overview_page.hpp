#pragma once
#include <QWidget>
#include <QJsonObject>
#include <memory>
class QNetworkAccessManager;
class MarketOverviewPage final:public QWidget {
 Q_OBJECT
 public:MarketOverviewPage(QString dedicatedSqlite,bool allowNetwork,QWidget* parent=nullptr,QNetworkAccessManager* transport=nullptr);~MarketOverviewPage()override;
 QJsonObject saveState()const;void restoreState(const QJsonObject& state);void setHostError(const QString& message);void previewImport(const QByteArray& bytes);QByteArray exportArchive()const;
 // Complete draft; overviewImportText is an editable segment only.
 QString importDraftText()const;
 void reloadSaved();
 signals:void openBoard(QString code,QString taxonomy);
 void openIndex(QString symbol);
 void openSecondHistory();
 public:QJsonObject sourceEvidence()const;
 protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
 private:struct Private;std::unique_ptr<Private> d;
};

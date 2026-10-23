#pragma once
#include "legacy_highfreq.hpp"
#include <QWidget>
#include <QThreadPool>
#include <atomic>
#include <memory>
class QComboBox;class QLabel;class QPushButton;class QPlainTextEdit;class Chart;
class LegacyHighFrequencyPage final:public QWidget {
 Q_OBJECT
 legacyHighFrequency::Store store;QThreadPool workers;quint64 generation=0;std::shared_ptr<std::atomic_bool> stopped=std::make_shared<std::atomic_bool>(false);
 QJsonObject catalog,packet;QComboBox *security,*date,*interval;QLabel *status;QPushButton*open;QPlainTextEdit*original;Chart*preview;bool filling=false,busy=false;QString restoreCode,restoreDate;
 void cancel();void controls();void loadInventory();void chooseSecurity();void loadSelection();void work(std::function<QJsonObject(legacyHighFrequency::Cancel)>,std::function<void(QJsonObject)>);
public:
 LegacyHighFrequencyPage(QString archivedSqlite,QString identitiesSqlite,QWidget* parent=nullptr);
 ~LegacyHighFrequencyPage()override;
 QJsonObject saveState()const;void restoreState(QJsonObject);QJsonObject sourceEvidence()const;
signals:void openOnMainChart(QJsonObject packet);
protected:void hideEvent(QHideEvent*)override;void showEvent(QShowEvent*)override;
};

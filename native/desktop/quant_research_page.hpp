#pragma once
#include "quant_research_store.hpp"
#include "quant_model_widget.hpp"
#include "quant_parquet_widget.hpp"
#include "page_snapshot_reader.hpp"
#include <QWidget>
#include <QComboBox>
#include <QPlainTextEdit>
#include <QListWidget>
#include <QLabel>
#include <QLineEdit>
#include <QStackedWidget>
#include <QTimer>
#include <QPointer>
class QDialog;
class MarketFeed;
#include <memory>
#include <atomic>
#include <mutex>
class QuantResearchPage:public QWidget {
 std::shared_ptr<QuantResearchStore> store;
 std::function<QJsonArray()> materialReader;
 std::function<void(QJsonObject)> sourceOpener;
 QComboBox *datasetPicker,*familyPicker,*materialPicker;
 QPlainTextEdit *parameters,*reader;
 QMap<QString,QLineEdit*> fields;
 QListWidget *history,*summary;
 QLabel *status=nullptr;
 QStackedWidget *views;
 QWidget *form;
 QuantModelWidget *models=nullptr;
 QPointer<QDialog> pluginsDialog;
 MarketFeed* historyFeed=nullptr;
 QuantParquetWidget *parquet=nullptr;
 PageSnapshotReader* snapshotReader=nullptr;
 QWidget* toolbar=nullptr;
 QJsonObject workspaceSnapshot,cleanUiState,parquetState;
 std::shared_ptr<std::shared_ptr<const QJsonObject>> restoreRequest=std::make_shared<std::shared_ptr<const QJsonObject>>();
 quint64 restoreSerial=0,appliedRestoreSerial=0;
 bool snapshotReady=false;
 std::function<void(QJsonObject)> parquetChartOpener;
 void ensureModels();void ensureParquet();
 void showRecordObject(const QJsonObject&);
 QJsonObject pending,pendingBaseline,viewBaseline;
 QJsonArray materials,availableMaterials;
 QString selectedId,readerText;
 int readerOffset=0;
 bool filling=false,viewWritable=true;
 QTimer draftTimer;
 // Final publication is a one-way claim; GUI cancellation never waits on disk IO.
 enum RunPhase{RunActive,RunCancelRequested,RunFinalizing};
 std::shared_ptr<std::atomic<RunPhase>> cancellation;
 bool cancelRun();
 void guard(std::function<void()>);
 void refresh();
 void fill(const QJsonObject&);
 QJsonObject config()const;
 void start();
 void showRecord(QString);
 void showText(QString);
 void renderReader();
 void persist();
 void applyState(QJsonObject);
public:
 QuantResearchPage(std::shared_ptr<QuantResearchStore>,std::function<QJsonArray()> existingMaterials,std::function<void(QJsonObject)> openSource,QWidget* parent=nullptr);
 ~QuantResearchPage()override;
 // Host calls only after its existing saved dailyEnabled check has passed.
 void prepareEnabledDailySchedule(){ensureModels();}
 void setMarketFeed(MarketFeed* feed){historyFeed=feed;}
 void setParquetChartOpener(std::function<void(QJsonObject)> fn){parquetChartOpener=fn;if(parquet)parquet->setChartOpener(fn);}
 void previewImport(const QByteArray&);
 void confirmImport();
 void cancelImport();
 bool back();
 void setDarkTheme(bool);
 QJsonObject saveState()const;
 void restoreState(const QJsonObject&);
protected:
 void hideEvent(QHideEvent*)override;
};

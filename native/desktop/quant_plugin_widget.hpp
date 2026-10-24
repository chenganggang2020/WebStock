#pragma once
#include "quant_plugin_host.hpp"
#include <QWidget>
#include <QMap>
#include <QPointer>
class MarketFeed;
class MarketHistoryRequest;
class QComboBox;
class QLineEdit;
class QFormLayout;
class QCheckBox;
class QLabel;
class QTabWidget;
class QListWidget;
class QSpinBox;
class QPushButton;
class QProgressBar;

class QuantPluginWidget : public QWidget {
    Q_OBJECT
    quantPlugin::Repository repository_;
    quantPlugin::Job job_;
    QString pluginId_;
    bool historyOnly_=false;
    QComboBox *operations_, *adjustment_, *datasets_;
    QLineEdit *runtime_, *input_, *filter_;
    QCheckBox *closed_;
    QSpinBox *timeout_;
    QFormLayout *parameters_, *form_;
    QMap<QString,QWidget*> fields_;
    QJsonObject operation_;
    QLabel *status_, *description_, *requestSummary_, *adjustmentHelp_, *environment_, *dataSummary_, *heading_;
    QWidget *controls_, *advanced_, *rangePresets_;
    QProgressBar* progress_;
    QPointer<MarketFeed> historyFeed_;
    QPointer<MarketHistoryRequest> historyReply_;
    QComboBox *sourceChoice_,*marketChoice_,*securityType_,*periodChoice_;
    QWidget *historyOptions_,*cacheActions_;
    QLabel* cacheState_;
    QPushButton *useCache_,*refreshMarket_;
    QJsonObject historyPlan_,batchQuery_;
    QJsonArray remainingRanges_;
    bool sharedBusy_=false,sharedCancelled_=false,sharedRefresh_=false;
    QJsonObject sharedQuery() const;
    void startSharedHistory(bool refresh);
    void nextHistoryRange();
    void finishHistoryRange(const QJsonObject& snapshot,const QString& error);
    void useSharedHistory(bool fresh=false);
    QTabWidget* results_;
    QListWidget* history_;
    QPushButton *run_, *cancel_;
    void guard(std::function<void()> action);
    void selectPlugin();
    void filterOperations();
    void selectOperation();
    void refreshHistory();
    void showResult(const QString& id,bool fresh=false);
    void start();
    bool isMarketQuery() const;
    QJsonObject parameters() const;
    void updateRequestSummary();
    void updateAvailability();
    void refreshDatasets();
    void restoreQuery(const QJsonObject& parameters);
    bool eventFilter(QObject* object,QEvent* event) override;
public:
    explicit QuantPluginWidget(QString root, QWidget* parent=nullptr, QString pluginId={}, bool historyOnly=false,MarketFeed* historyFeed=nullptr);
    ~QuantPluginWidget() override;
    bool isRunning() const { return job_.active()||sharedBusy_; }
    void useSavedData(const QString& runId);
    std::function<void(QString,QString)> openDataConsumer;
};

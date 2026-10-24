#pragma once
#include "quant_plugin_host.hpp"
#include <QWidget>
#include <QMap>
#include <QPointer>
class QDialog;
class QTableWidget;
class QListWidget;
class QLineEdit;
class QComboBox;
class QPushButton;
class QLabel;
class MarketFeed;

// The center manages installed packages; each business window owns only the
// selected plugin's form, process and history.
class QuantPluginCenter : public QWidget {
    Q_OBJECT
    quantPlugin::Repository repository_;
    quantPlugin::Job archive_;
    MarketFeed* historyFeed_=nullptr;
    QString packageDirectory_;
    QMap<QString,QJsonObject> available_,entries_;
    QMap<QString,QPointer<QDialog>> windows_;
    QTableWidget* catalog_;
    QListWidget* shortcuts_;
    QLineEdit* search_;
    QComboBox* scope_;
    QLabel *detail_,*status_,*source_;
    QPushButton *install_,*open_,*toggle_,*uninstall_,*history_;
    void guard(std::function<void()> action);
    void discover();
    void refresh();
    void select();
    QString selectedId() const;
    void closeBusiness(const QString& id);
    void openPlugin(const QString& id,bool historyOnly=false,const QString& datasetId={});
public:
    explicit QuantPluginCenter(QString root,QWidget* parent=nullptr,QString packageDirectory={},MarketFeed* historyFeed=nullptr);
};

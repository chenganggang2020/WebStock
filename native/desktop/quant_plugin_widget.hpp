#pragma once
#include "quant_plugin_host.hpp"
#include <QWidget>
#include <QMap>
class QComboBox;
class QLineEdit;
class QFormLayout;
class QCheckBox;
class QLabel;
class QTabWidget;
class QListWidget;
class QSpinBox;
class QPushButton;

class QuantPluginWidget : public QWidget {
    quantPlugin::Repository repository_;
    quantPlugin::Job job_;
    QComboBox *plugins_, *operations_, *adjustment_;
    QLineEdit *runtime_, *input_, *filter_;
    QCheckBox *closed_, *enabled_;
    QSpinBox *timeout_;
    QFormLayout* parameters_;
    QMap<QString,QWidget*> fields_;
    QJsonObject operation_;
    QLabel *status_, *description_;
    QTabWidget* results_;
    QListWidget* history_;
    QPushButton* run_;
    void guard(std::function<void()> action);
    void refreshPlugins();
    void selectPlugin();
    void filterOperations();
    void selectOperation();
    void refreshHistory();
    void showResult(const QString& id);
    void start();
public:
    explicit QuantPluginWidget(QString root, QWidget* parent=nullptr);
    ~QuantPluginWidget() override;
};

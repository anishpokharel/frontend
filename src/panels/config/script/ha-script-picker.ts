import { consume } from "@lit-labs/context";
import {
  mdiContentDuplicate,
  mdiDelete,
  mdiHelpCircle,
  mdiInformationOutline,
  mdiPlay,
  mdiPlus,
  mdiScriptText,
  mdiTag,
  mdiTransitConnection,
} from "@mdi/js";
import { differenceInDays } from "date-fns/esm";
import { UnsubscribeFunc } from "home-assistant-js-websocket";
import {
  CSSResultGroup,
  LitElement,
  TemplateResult,
  css,
  html,
  nothing,
} from "lit";
import { customElement, property, state } from "lit/decorators";
import { styleMap } from "lit/directives/style-map";
import memoizeOne from "memoize-one";
import { isComponentLoaded } from "../../../common/config/is_component_loaded";
import { formatShortDateTime } from "../../../common/datetime/format_date_time";
import { relativeTime } from "../../../common/datetime/relative_time";
import { HASSDomEvent, fireEvent } from "../../../common/dom/fire_event";
import { computeStateName } from "../../../common/entity/compute_state_name";
import { navigate } from "../../../common/navigate";
import { LocalizeFunc } from "../../../common/translations/localize";
import {
  DataTableColumnContainer,
  RowClickedEvent,
} from "../../../components/data-table/ha-data-table";
import "../../../components/data-table/ha-data-table-labels";
import "../../../components/ha-fab";
import "../../../components/ha-filter-blueprints";
import "../../../components/ha-filter-categories";
import "../../../components/ha-filter-devices";
import "../../../components/ha-filter-entities";
import "../../../components/ha-filter-floor-areas";
import "../../../components/ha-filter-labels";
import "../../../components/ha-icon-button";
import "../../../components/ha-icon-overflow-menu";
import "../../../components/ha-svg-icon";
import {
  CategoryRegistryEntry,
  subscribeCategoryRegistry,
} from "../../../data/category_registry";
import { fullEntitiesContext } from "../../../data/context";
import { UNAVAILABLE } from "../../../data/entity";
import { EntityRegistryEntry } from "../../../data/entity_registry";
import {
  LabelRegistryEntry,
  subscribeLabelRegistry,
} from "../../../data/label_registry";
import {
  ScriptEntity,
  deleteScript,
  fetchScriptFileConfig,
  getScriptStateConfig,
  showScriptEditor,
  triggerScript,
} from "../../../data/script";
import { findRelated } from "../../../data/search";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../../dialogs/generic/show-dialog-box";
import "../../../layouts/hass-tabs-subpage-data-table";
import { SubscribeMixin } from "../../../mixins/subscribe-mixin";
import { haStyle } from "../../../resources/styles";
import { HomeAssistant, Route } from "../../../types";
import { documentationUrl } from "../../../util/documentation-url";
import { showToast } from "../../../util/toast";
import { showNewAutomationDialog } from "../automation/show-dialog-new-automation";
import { showAssignCategoryDialog } from "../category/show-dialog-assign-category";
import { configSections } from "../ha-panel-config";

type ScriptItem = ScriptEntity & {
  name: string;
  category: string | undefined;
  labels: LabelRegistryEntry[];
};

@customElement("ha-script-picker")
class HaScriptPicker extends SubscribeMixin(LitElement) {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public scripts!: ScriptEntity[];

  @property({ type: Boolean }) public isWide = false;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public route!: Route;

  @property({ attribute: false }) public entityRegistry!: EntityRegistryEntry[];

  @state() private _searchParms = new URLSearchParams(window.location.search);

  @state() private _activeFilters?: string[];

  @state() private _filteredScripts?: string[] | null;

  @state() private _filters: Record<
    string,
    { value: string[] | undefined; items: Set<string> | undefined }
  > = {};

  @state() private _expandedFilter?: string;

  @state()
  _categories!: CategoryRegistryEntry[];

  @state()
  _labels!: LabelRegistryEntry[];

  @state()
  @consume({ context: fullEntitiesContext, subscribe: true })
  _entityReg!: EntityRegistryEntry[];

  private _scripts = memoizeOne(
    (
      scripts: ScriptEntity[],
      entityReg: EntityRegistryEntry[],
      categoryReg?: CategoryRegistryEntry[],
      labelReg?: LabelRegistryEntry[],
      filteredScripts?: string[] | null
    ): ScriptItem[] => {
      if (filteredScripts === null) {
        return [];
      }
      return (
        filteredScripts
          ? scripts.filter((script) =>
              filteredScripts!.includes(script.entity_id)
            )
          : scripts
      ).map((script) => {
        const entityRegEntry = entityReg.find(
          (reg) => reg.entity_id === script.entity_id
        );
        const category = entityRegEntry?.categories.script;
        const labels = labelReg && entityRegEntry?.labels;
        return {
          ...script,
          name: computeStateName(script),
          last_triggered: script.attributes.last_triggered || undefined,
          category: category
            ? categoryReg?.find((cat) => cat.category_id === category)?.name
            : undefined,
          labels: (labels || []).map(
            (lbl) => labelReg!.find((label) => label.label_id === lbl)!
          ),
        };
      });
    }
  );

  private _columns = memoizeOne(
    (
      narrow,
      localize: LocalizeFunc,
      locale: HomeAssistant["locale"]
    ): DataTableColumnContainer<ScriptItem> => {
      const columns: DataTableColumnContainer = {
        icon: {
          title: "",
          label: localize("ui.panel.config.script.picker.headers.state"),
          type: "icon",
          template: (script) =>
            html`<ha-state-icon
              .hass=${this.hass}
              .stateObj=${script}
              style=${styleMap({
                color:
                  script.state === UNAVAILABLE ? "var(--error-color)" : "unset",
              })}
            ></ha-state-icon>`,
        },
        name: {
          title: localize("ui.panel.config.script.picker.headers.name"),
          main: true,
          sortable: true,
          filterable: true,
          direction: "asc",
          grows: true,
          template: (script) => {
            const date = new Date(script.last_triggered);
            const now = new Date();
            const dayDifference = differenceInDays(now, date);
            return html`
              <div style="font-size: 14px;">${script.name}</div>
              ${narrow
                ? html`<div class="secondary">
                    ${this.hass.localize("ui.card.automation.last_triggered")}:
                    ${script.attributes.last_triggered
                      ? dayDifference > 3
                        ? formatShortDateTime(date, locale, this.hass.config)
                        : relativeTime(date, locale)
                      : localize("ui.components.relative_time.never")}
                  </div>`
                : nothing}
              ${script.labels.length
                ? html`<ha-data-table-labels
                    @label-clicked=${this._labelClicked}
                    .labels=${script.labels}
                  ></ha-data-table-labels>`
                : nothing}
            `;
          },
        },
        category: {
          title: localize("ui.panel.config.script.picker.headers.category"),
          hidden: true,
          groupable: true,
          filterable: true,
          sortable: true,
        },
        labels: {
          title: "",
          hidden: true,
          filterable: true,
          template: (script) => script.labels.map((lbl) => lbl.name).join(" "),
        },
      };
      if (!narrow) {
        columns.last_triggered = {
          sortable: true,
          width: "40%",
          title: localize("ui.card.automation.last_triggered"),
          template: (script) => {
            const date = new Date(script.last_triggered);
            const now = new Date();
            const dayDifference = differenceInDays(now, date);
            return html`
              ${script.last_triggered
                ? dayDifference > 3
                  ? formatShortDateTime(
                      date,
                      this.hass.locale,
                      this.hass.config
                    )
                  : relativeTime(date, this.hass.locale)
                : this.hass.localize("ui.components.relative_time.never")}
            `;
          },
        };
      }

      columns.actions = {
        title: "",
        width: "64px",
        type: "overflow-menu",
        template: (script) => html`
          <ha-icon-overflow-menu
            .hass=${this.hass}
            narrow
            .items=${[
              {
                path: mdiInformationOutline,
                label: this.hass.localize(
                  "ui.panel.config.script.picker.show_info"
                ),
                action: () => this._showInfo(script),
              },
              {
                path: mdiTag,
                label: this.hass.localize(
                  `ui.panel.config.script.picker.${script.category ? "edit_category" : "assign_category"}`
                ),
                action: () => this._editCategory(script),
              },
              {
                path: mdiPlay,
                label: this.hass.localize("ui.panel.config.script.picker.run"),
                action: () => this._runScript(script),
              },
              {
                path: mdiTransitConnection,
                label: this.hass.localize(
                  "ui.panel.config.script.picker.show_trace"
                ),
                action: () => this._showTrace(script),
              },
              {
                divider: true,
              },
              {
                path: mdiContentDuplicate,
                label: this.hass.localize(
                  "ui.panel.config.script.picker.duplicate"
                ),
                action: () => this._duplicate(script),
              },
              {
                label: this.hass.localize(
                  "ui.panel.config.script.picker.delete"
                ),
                path: mdiDelete,
                action: () => this._deleteConfirm(script),
                warning: true,
              },
            ]}
          >
          </ha-icon-overflow-menu>
        `,
      };

      return columns;
    }
  );

  protected hassSubscribe(): (UnsubscribeFunc | Promise<UnsubscribeFunc>)[] {
    return [
      subscribeCategoryRegistry(
        this.hass.connection,
        "script",
        (categories) => {
          this._categories = categories;
        }
      ),
      subscribeLabelRegistry(this.hass.connection, (labels) => {
        this._labels = labels;
      }),
    ];
  }

  protected render(): TemplateResult {
    return html`
      <hass-tabs-subpage-data-table
        .hass=${this.hass}
        .narrow=${this.narrow}
        back-path="/config"
        .route=${this.route}
        .tabs=${configSections.automations}
        hasFilters
        initialGroupColumn="category"
        .filters=${Object.values(this._filters).filter(
          (filter) => filter.value?.length
        ).length}
        .columns=${this._columns(
          this.narrow,
          this.hass.localize,
          this.hass.locale
        )}
        .data=${this._scripts(
          this.scripts,
          this._entityReg,
          this._categories,
          this._labels,
          this._filteredScripts
        )}
        .empty=${!this.scripts.length}
        .activeFilters=${this._activeFilters}
        id="entity_id"
        .noDataText=${this.hass.localize(
          "ui.panel.config.script.picker.no_scripts"
        )}
        @clear-filter=${this._clearFilter}
        hasFab
        clickable
        class=${this.narrow ? "narrow" : ""}
        @row-click=${this._handleRowClicked}
      >
        <ha-icon-button
          slot="toolbar-icon"
          .label=${this.hass.localize("ui.common.help")}
          .path=${mdiHelpCircle}
          @click=${this._showHelp}
        ></ha-icon-button>
        <ha-filter-floor-areas
          .hass=${this.hass}
          .type=${"script"}
          .value=${this._filters["ha-filter-floor-areas"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-floor-areas"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-floor-areas>
        <ha-filter-devices
          .hass=${this.hass}
          .type=${"script"}
          .value=${this._filters["ha-filter-devices"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-devices"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-devices>
        <ha-filter-entities
          .hass=${this.hass}
          .type=${"script"}
          .value=${this._filters["ha-filter-entities"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-entities"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-entities>
        <ha-filter-labels
          .hass=${this.hass}
          .value=${this._filters["ha-filter-labels"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-labels"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-labels>
        <ha-filter-categories
          .hass=${this.hass}
          scope="script"
          .value=${this._filters["ha-filter-categories"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-categories"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-categories>
        <ha-filter-blueprints
          .hass=${this.hass}
          .type=${"script"}
          .value=${this._filters["ha-filter-blueprints"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-blueprints"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-blueprints>
        ${!this.scripts.length
          ? html` <div class="empty" slot="empty">
              <ha-svg-icon .path=${mdiScriptText}></ha-svg-icon>
              <h1>
                ${this.hass.localize(
                  "ui.panel.config.script.picker.empty_header"
                )}
              </h1>
              <p>
                ${this.hass.localize(
                  "ui.panel.config.script.picker.empty_text"
                )}
              </p>
              <a
                href=${documentationUrl(this.hass, "/docs/script/editor/")}
                target="_blank"
                rel="noreferrer"
              >
                <ha-button>
                  ${this.hass.localize("ui.panel.config.common.learn_more")}
                </ha-button>
              </a>
            </div>`
          : nothing}
        <ha-fab
          slot="fab"
          ?is-wide=${this.isWide}
          ?narrow=${this.narrow}
          .label=${this.hass.localize(
            "ui.panel.config.script.picker.add_script"
          )}
          extended
          @click=${this._createNew}
        >
          <ha-svg-icon slot="icon" .path=${mdiPlus}></ha-svg-icon>
        </ha-fab>
      </hass-tabs-subpage-data-table>
    `;
  }

  private _filterExpanded(ev) {
    if (ev.detail.expanded) {
      this._expandedFilter = ev.target.localName;
    } else if (this._expandedFilter === ev.target.localName) {
      this._expandedFilter = undefined;
    }
  }

  private _labelClicked = (ev: CustomEvent) => {
    const label = ev.detail.label;
    this._filters = {
      ...this._filters,
      "ha-filter-labels": {
        value: [label.label_id],
        items: undefined,
      },
    };
    this._applyFilters();
  };

  private _filterChanged(ev) {
    const type = ev.target.localName;
    this._filters[type] = ev.detail;
    this._applyFilters();
  }

  private _clearFilter() {
    this._filters = {};
    this._applyFilters();
  }

  private _applyFilters() {
    const filters = Object.entries(this._filters);
    let items: Set<string> | undefined;
    for (const [key, filter] of filters) {
      if (filter.items) {
        if (!items) {
          items = filter.items;
          continue;
        }
        items =
          "intersection" in items
            ? // @ts-ignore
              items.intersection(filter.items)
            : new Set([...items].filter((x) => filter.items!.has(x)));
      }
      if (key === "ha-filter-categories" && filter.value?.length) {
        const categoryItems: Set<string> = new Set();
        this.scripts
          .filter(
            (script) =>
              filter.value![0] ===
              this._entityReg.find((reg) => reg.entity_id === script.entity_id)
                ?.categories.script
          )
          .forEach((script) => categoryItems.add(script.entity_id));
        if (!items) {
          items = categoryItems;
          continue;
        }
        items =
          "intersection" in items
            ? // @ts-ignore
              items.intersection(categoryItems)
            : new Set([...items].filter((x) => categoryItems!.has(x)));
      }
      if (key === "ha-filter-labels" && filter.value?.length) {
        const labelItems: Set<string> = new Set();
        this.scripts
          .filter((script) =>
            this._entityReg
              .find((reg) => reg.entity_id === script.entity_id)
              ?.labels.some((lbl) => filter.value!.includes(lbl))
          )
          .forEach((script) => labelItems.add(script.entity_id));
        if (!items) {
          items = labelItems;
          continue;
        }
        items =
          "intersection" in items
            ? // @ts-ignore
              items.intersection(labelItems)
            : new Set([...items].filter((x) => labelItems!.has(x)));
      }
    }
    this._filteredScripts = items ? [...items] : undefined;
  }

  firstUpdated() {
    if (this._searchParms.has("blueprint")) {
      this._filterBlueprint();
    }
  }

  private async _filterBlueprint() {
    const blueprint = this._searchParms.get("blueprint");
    if (!blueprint) {
      return;
    }
    const related = await findRelated(this.hass, "script_blueprint", blueprint);
    this._filters = {
      ...this._filters,
      "ha-filter-blueprints": {
        value: [blueprint],
        items: new Set(related.automation || []),
      },
    };
    this._applyFilters();
  }

  private _editCategory(script: any) {
    const entityReg = this._entityReg.find(
      (reg) => reg.entity_id === script.entity_id
    );
    if (!entityReg) {
      showAlertDialog(this, {
        title: this.hass.localize(
          "ui.panel.config.script.picker.no_category_support"
        ),
        text: this.hass.localize(
          "ui.panel.config.script.picker.no_category_entity_reg"
        ),
      });
      return;
    }
    showAssignCategoryDialog(this, {
      scope: "script",
      entityReg,
    });
  }

  private _handleRowClicked(ev: HASSDomEvent<RowClickedEvent>) {
    const entry = this.entityRegistry.find((e) => e.entity_id === ev.detail.id);
    if (entry) {
      navigate(`/config/script/edit/${entry.unique_id}`);
    } else {
      navigate(`/config/script/show/${ev.detail.id}`);
    }
  }

  private _createNew() {
    if (isComponentLoaded(this.hass, "blueprint")) {
      showNewAutomationDialog(this, { mode: "script" });
    } else {
      navigate("/config/script/edit/new");
    }
  }

  private _runScript = async (script: any) => {
    const entry = this.entityRegistry.find(
      (e) => e.entity_id === script.entity_id
    );
    if (!entry) {
      return;
    }
    await triggerScript(this.hass, entry.unique_id);
    showToast(this, {
      message: this.hass.localize("ui.notification_toast.triggered", {
        name: computeStateName(script),
      }),
    });
  };

  private _showInfo(script: any) {
    fireEvent(this, "hass-more-info", { entityId: script.entity_id });
  }

  private _showTrace(script: any) {
    const entry = this.entityRegistry.find(
      (e) => e.entity_id === script.entity_id
    );
    if (entry) {
      navigate(`/config/script/trace/${entry.unique_id}`);
    }
  }

  private _showHelp() {
    showAlertDialog(this, {
      title: this.hass.localize("ui.panel.config.script.caption"),
      text: html`
        ${this.hass.localize("ui.panel.config.script.picker.introduction")}
        <p>
          <a
            href=${documentationUrl(this.hass, "/docs/scripts/")}
            target="_blank"
            rel="noreferrer"
          >
            ${this.hass.localize("ui.panel.config.script.picker.learn_more")}
          </a>
        </p>
      `,
    });
  }

  private async _duplicate(script: any) {
    try {
      const entry = this.entityRegistry.find(
        (e) => e.entity_id === script.entity_id
      );
      if (!entry) {
        return;
      }
      const config = await fetchScriptFileConfig(this.hass, entry.unique_id);
      showScriptEditor({
        ...config,
        alias: `${config?.alias} (${this.hass.localize(
          "ui.panel.config.script.picker.duplicate"
        )})`,
      });
    } catch (err: any) {
      if (err.status_code === 404) {
        const response = await getScriptStateConfig(
          this.hass,
          script.entity_id
        );
        showScriptEditor(response.config);
        return;
      }
      await showAlertDialog(this, {
        text: this.hass.localize(
          "ui.panel.config.script.editor.load_error_unknown",
          { err_no: err.status_code }
        ),
      });
    }
  }

  private async _deleteConfirm(script: any) {
    showConfirmationDialog(this, {
      title: this.hass.localize(
        "ui.panel.config.script.editor.delete_confirm_title"
      ),
      text: this.hass.localize(
        "ui.panel.config.script.editor.delete_confirm_text",
        { name: script.name }
      ),
      confirmText: this.hass!.localize("ui.common.delete"),
      dismissText: this.hass!.localize("ui.common.cancel"),
      confirm: () => this._delete(script),
      destructive: true,
    });
  }

  private async _delete(script: any) {
    try {
      const entry = this.entityRegistry.find(
        (e) => e.entity_id === script.entity_id
      );
      if (entry) {
        await deleteScript(this.hass, entry.unique_id);
      }
    } catch (err: any) {
      await showAlertDialog(this, {
        text:
          err.status_code === 400
            ? this.hass.localize(
                "ui.panel.config.script.editor.load_error_not_deletable"
              )
            : this.hass.localize(
                "ui.panel.config.script.editor.load_error_unknown",
                { err_no: err.status_code }
              ),
      });
    }
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        hass-tabs-subpage-data-table {
          --data-table-row-height: 60px;
        }
        hass-tabs-subpage-data-table.narrow {
          --data-table-row-height: 72px;
        }
        a {
          text-decoration: none;
        }
        .empty {
          --paper-font-headline_-_font-size: 28px;
          --mdc-icon-size: 80px;
          max-width: 500px;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-script-picker": HaScriptPicker;
  }
}

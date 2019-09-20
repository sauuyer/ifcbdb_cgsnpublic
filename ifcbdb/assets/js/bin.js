//************* Local Variables ***********************/
var _bin = ""; // Bin Id
var _dataset = ""; // Dataset Name (for grouping)
var _tags = ""; // Tags, comma separated (for grouping)
var _instrument = ""; // Instrument name (for grouping)
var _mosaicPage = 0; // Current page being displayed in the mosaic
var _mosaicPages = -1; // Total number of pages for the mosaic
var _coordinates = []; // Coordinates of images within the current mosaic
var _isMosaicLoading = false; // Whether the mosaic is in the process of loading
var _isBinLoading = false; // Whether the bin is in the process of loading
var _plotData = null; // Local storage of the current bin's plot data
var _map = null; // Current Leaflet map
var _marker = null; // Current marker shown on the map
var _workspace = "mosaic"; // The current workspace a user is seeing
var _pendingMapLocation = null; // The next map position to render (see notes in updateMapLocation)
var _csrf = null; // CSRF token from Django for post requests
var _userId = null; // Id of the currently logged in user
var _commentTable = null; // Variable to keep track of the DataTables object once created
var _route = ""; // Tracks the route used to render this page (timeline or bin)
var _binTimestamp = null; // Timestamp for the currently selected bin
var _preventTimelineRelayout = false; // Used to prevent a relayout on the timeline when switching metrics
var _filterPopover; // Tracks the container created by the popover library for applying filters

//************* Common Methods ***********************/

// Generates a relative link to the current bin/dataset
// TODO: Verify these URLs match the current Django routes
function createLink() {
    if (_dataset != "" || _instrument != "" || _tags != "") {
        var link = "/timeline?dataset="+_dataset+"&instrument="+_instrument+"&tags="+_tags;
        if (_bin != "") {
            link += "&bin=" + _bin;
        }
        return link;
    }

    return createBinModeLink();
}

function createBinModeLink() {
    return "/bin?bin=" + _bin;
}

function getGroupingParameters(bin) {
    var parameters = []
    if (bin != "")
        parameters.push("bin=" + bin);
    if (_dataset != "")
        parameters.push("dataset=" + _dataset);
    if (_instrument != "")
        parameters.push("instrument=" + _instrument);
    if (_tags != "") {
        parameters.push("tags=" + _tags);
    }

    if (parameters.length == 0)
        return "";

    return parameters.join("&");
}

function getQuerystringFromParameters(dataset, instrument, tags) {
    var parameters = []
    if (dataset != "")
        parameters.push("dataset=" + dataset);
    if (instrument != "")
        parameters.push("instrument=" + instrument);
    if (tags != "") {
        parameters.push("tags=" + tags);
    }

    if (parameters.length == 0)
        return "";

    return parameters.join("&");
}

function createBinLink(bin) {
    if (_route == "bin") {
        return "/bin?bin=" + bin;
    }

    return "/timeline?" + getGroupingParameters(bin);
}

function createImageLink(imageId) {
    if (_route == "bin") {
        return "/image?image=" + imageId + "&bin=" + _bin;
    }

    var url = "/image?image=" + imageId;
    var parameters = getGroupingParameters(_bin);
    if (parameters != "")
        url += "&" + parameters;

    return url;
}

// Switches between workspaces: map, plot, mosaic
function showWorkspace(workspace) {
    _workspace = workspace;

    $("#image-tab-content").toggleClass("d-none", !(workspace == "mosaic"));
    //$("#mosaic-footer").toggleClass("d-none", !(workspace == "mosaic"));
    $("#plot-tab-content").toggleClass("d-none", !(workspace == "plot"));
    $("#map-tab-content").toggleClass("d-none", !(workspace == "map"));

    // After showing the map, Leaflet needs to have invalidateSize called to recalculate the
    //   dimensions of the map container (it cannot determine it when the container is hidden
    if (workspace == "map") {
        if (_map) {
            setTimeout(function() { _map.invalidateSize() }, 100);
        }

        if (_pendingMapLocation != null) {
            updateMapLocation(_pendingMapLocation);
        }
    }
}

function initTimelineFilter() {
    _filterPopover = $('[data-toggle="popover"]').popover({
      container: 'body',
      title: 'Update Filters',
      html: true,
      placement: 'bottom',
      sanitize: false,
      content: function () {
          return $("#SearchPopoverContent").html();
      }
    });

    _filterPopover.on('shown.bs.popover', function () {
        $(".popover .tag-filter").chosen({
            placeholder_text_multiple: "Select Tags..."
        });

        $(".popover .dataset-filter, .popover .instrument-filter, .popover .tag-filter").change(function(){
            var wrapper = $(this).closest(".filter-options");
            var datasetFilter = wrapper.find(".dataset-filter");
            var dataset = datasetFilter.val();
            var instrumentFilter = wrapper.find(".instrument-filter");
            var instrument = instrumentFilter.val();
            var tagFilter = wrapper.find(".tag-filter");
            var tags = tagFilter.val().join();
            var url = "/api/filter_options" +
                "?dataset=" + (dataset ? dataset : "") +
                "&instrument=" + (instrument ? instrument : "") +
                "&tags=" + (tags ? tags : "");

            $.get(url, function(data){
                datasetFilter.empty();
                datasetFilter.append($("<option value='' />"));
                for (var i = 0; i < data.dataset_options.length; i++) {
                    var option = data.dataset_options[i];
                    datasetFilter.append($("<option value='" + option + "'>" + option + "</option>"));
                }
                datasetFilter.val(dataset);

                instrumentFilter.empty();
                instrumentFilter.append($("<option value='' />"));
                for (var i = 0; i < data.instrument_options.length; i++) {
                    var option = data.instrument_options[i];
                    instrumentFilter.append($("<option value='" + option + "'>IFCB" + option + "</option>"));
                }
                instrumentFilter.val(instrument);

                tagFilter.empty();
                for (var i = 0; i < data.tag_options.length; i++) {
                    var option = data.tag_options[i];

                    var element = $("<option value='" + option + "'>" + option + "</option>");
                    if (tags.includes(option))
                        element.attr("selected", "selected");

                    tagFilter.append(element);
                }

                tagFilter.trigger('chosen:updated');
            });
        });
    });
}

function applyFilters() {
    var dataset = $(".popover .dataset-filter").val();
    var instrument = $(".popover .instrument-filter").val();
    var tags = $(".popover .tag-filter option:selected")
        .map(function() {return $(this).val()}).get()
        .join();

    var qs = getQuerystringFromParameters(dataset, instrument, tags);

    $.get("/api/bin_exists?" + qs, function(data){
        if (!data.exists) {
            alert("No bins were found matching the specified filters. Please update the filters and try again")
            return;
        }

        _dataset = dataset;
        _instrument = instrument;
        _tags = tags;
        location.href = createBinLink(_bin);
    });

    return false;
}

//************* Bin Methods ***********************/
function updateBinStats(data) {
    var timestamp = moment.utc(data["timestamp_iso"]);

    $("#stat-date-time").html(
        timestamp.format("YYYY-MM-DD") + "<br />" +
        timestamp.format("HH:mm:ss z") +
        "<br /> (" + timestamp.fromNow() + ")"
    );

    $("#stat-instrument").html(data["instrument"]);
    $("#stat-instrument-link").attr('href','/timeline?instrument='+data["instrument"]+'&bin='+_bin);
    $("#stat-num-triggers").html(data["num_triggers"]);
    $("#stat-num-images").html(data["num_images"]);
    $("#stat-trigger-freq").html(data["trigger_freq"]);
    $("#stat-ml-analyzed").html(data["ml_analyzed"]);
    $("#stat-concentration").html(data["concentration"]);
    $("#stat-size").html(filesize(data["size"]));
    $("#stat-skip")
        .text(data["skip"] ? "Yes" : "No")
        .data("skipped", data["skip"]);
}

function updateBinMetadata() {
    $.get("/api/metadata/" + _bin, function(data) {
        tbody = $("#bin-metadata tbody");
        tbody.empty();

        for (key in data.metadata) {
            row = $("<tr />");
            row.append($("<td />", { "scope": "row", "text": key }))
            row.append($("<td />", { "text": data.metadata[key] }))
            tbody.append(row);
        }
    });
}

function updateBinDatasets(data) {
    $("#dataset-links").empty();

    for (var i = 0; i < data.datasets.length; i++) {
        // <a href="#" class="d-block">asdasd</a>
        $("#dataset-links").append(
            $("<a class='d-block' />")
            .attr("href", "/timeline?bin=" + _bin + "&dataset=" + data.datasets[i])
            .text(data.datasets[i])
        )
    }
}

function updateBinTags(data) {
    displayTags(data.tags);
    toggleTagInput(false);
}

function updateBinComments(data) {
    displayComments(data.comments);
}

function updateBinDownloadLinks(data) {
    $("#download-adc").attr("href", "/data/" + _bin + ".adc");
    $("#download-hdr").attr("href", "/data/" + _bin + ".hdr");
    $("#download-roi").attr("href", "/data/" + _bin + ".roi");
    $("#download-zip").attr("href", "/data/" + _bin + ".zip");
    $("#download-blobs").attr("href", "/data/" + _bin + "_blob.zip");
    $("#download-features").attr("href", "/data/" + _bin + "_features.csv");
    $("#download-class-scores").attr("href", "/data/" + _bin + "_class_scores.mat");

    $.get('/api/has_products/' + _bin, function(r) {
        $("#download-blobs").toggle(r["has_blobs"]);
        $("#download-blobs-disabled").toggle(!r["has_blobs"]);

        $("#download-features").toggle(r["has_features"]);
        $("#download-features-disabled").toggle(!r["has_features"]);

        $("#download-class-scores").toggle(r["has_class_scores"]);
        $("#download-class-scores-disabled").toggle(!r["has_class_scores"]);

        // Update outline/blob links
        $("#detailed-image-blob-link").toggleClass("disabled", !r["has_blobs"]);
        $("#detailed-image-outline-link").toggleClass("disabled", !r["has_blobs"]);
    });
}

function changeToClosestBin(targetDate) {
    if (_isBinLoading || _isMosaicLoading)
        return false;

    _isBinLoading = true;
    _isMosaicLoading = true;

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "target_date": targetDate,
        "dataset": _dataset,
        "instrument": _instrument,
        "tags": _tags
    }

    $.post("/api/closest_bin", payload, function(resp) {
        if (resp.bin_id != "")
            changeBin(resp.bin_id, true);
    });
}

function changeToNearestBin(lat, lng) {
    if (_isBinLoading || _isMosaicLoading)
        return false;

    _isBinLoading = true;
    _isMosaicLoading = true;

    var payload = {
        csrfmiddlewaretoken: _csrf,
        dataset: _dataset,
        latitude: lat,
        longitude: lng,
        instrument: _instrument,
        tags: _tags
    };

    $.post("/api/nearest_bin", payload, function(resp) {
        if (resp.bin_id != "")
            changeBin(resp.bin_id, true);
    });
}

//************* Tagging Methods ***********************/
function toggleTagInput(isAdding) {
    $("#add-tag").toggleClass("d-none", isAdding)
    $("#tag-name").toggleClass("d-none", !isAdding)
    $("#tag-confirm").toggleClass("d-none", !isAdding)
    $("#tag-cancel").toggleClass("d-none", !isAdding)
}

function addTag() {
    var tag = $("#tag-name").val();
    if (tag.trim() === "")
        return;

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "tag_name": tag
    };

    $.post("/secure/api/add-tag/" + _bin, payload, function(data) {
        displayTags(data.tags);
        $("#tag-name").val("");
    });
}

function removeTag(tag) {
    if (String(tag).trim() === "")
        return;

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "tag_name": tag
    };

    $.post("/secure/api/remove-tag/" + _bin, payload, function(data) {
        displayTags(data.tags);
    });
}

function displayTags(tags) {
    var list = $("#tags");
    list.empty();

    for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        var li = $("<span class='badge badge-pill badge-light mx-1'>");
        var link = "timeline?tags="+tag;
        if (_dataset != "") {
            link += "&dataset="+_dataset;
        }
        if (_instrument != "") {
            link += "&instrument="+_instrument;
        }
        var span = li.html("<a href='"+link+"'>"+tag+"</a>");
        var icon = $("<i class='fas fa-times pl-1'></i>");
        var remove = $("<a href='javascript:;' class='remove-tag' data-tag='" + tag + "' />");

        li.append(span);

        if (_userId != null) {
            li.append(remove);
            remove.append(icon);
        }

        list.append(li);
    }
}

//************* Comment Methods ***********************/
function addComment() {
    var content = $("#comment-input").val().trim();
    if (content === "") {
        return;
    }

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "comment": content
    };

    $.post("/secure/api/add-comment/" + _bin, payload, function(data){
        $("#comment-input").val("");
        displayComments(data.comments);
    });
}

function editComment(id) {
    $.get("/secure/api/edit-comment/" + _bin + "?id=" + id, function(data){
        if (data.id && data.id > 0) {
            $("#comment-id").val(data.id);
            $("#comment-input").val(data.content);
            $("#cancel-comment").toggleClass("d-none", false);
            $("#update-comment").toggleClass("d-none", false);
            $("#confirm-comment").toggleClass("d-none", true);
        }
    })
}

function cancelComment() {
    $("#comment-id").val("");
    $("#comment-input").val("");
    $("#cancel-comment").toggleClass("d-none", true);
    $("#update-comment").toggleClass("d-none", true);
    $("#confirm-comment").toggleClass("d-none", false);
}

function updateComment() {
    var content = $("#comment-input").val().trim();
    var id = $("#comment-id").val();
    if (content === "" || id === "") {
        return;
    }

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "id": id,
        "content": content
    };

    $.post("/secure/api/update-comment/" + _bin, payload, function(data){
        $("#comment-input").val("");
        cancelComment();
        displayComments(data.comments);
    });
}

function deleteComment(id) {
    if (id == null || id == "")
        return;

    if (!confirm("Are you sure you want to delete this comment?"))
        return;

    var payload = {
        "csrfmiddlewaretoken": _csrf,
        "id": id
    };

    $.post("/secure/api/delete-comment/" + _bin, payload, function(data){
        displayComments(data.comments);
    });
}

function displayComments(comments) {
    $(".comment-total").text(comments.length);
    if (_commentTable != null) {
        _commentTable.clear();
        _commentTable.rows.add(comments);
        _commentTable.draw();
        return;
    }
    _commentTable = $("#binCommentsTable").DataTable({
        searching: false,
        lengthChange: false,
        data: comments,
        order: [[ 1, "desc" ]],
        columns: [
            { // Date
                render: function(data, type, row) {
                    return moment.utc(data).format("YYYY-MM-DD HH:mm:ss z");
                }
            },
            {}, // Comment
            {}, // User
            { // Edit/Delete
                targets: -1,
                render: function(data, type, row ) {
                    var html = "";
                    // Only show edit/delete if the comment was posted by the user viewing them
                    if (row[4] == _userId) {
                        html +=
                            "<button class='btn btn-sm py-1 px-2 edit-comment' data-id='" + data + "'><i class='fas fa-edit'></i></button>" +
                            "<button class='btn btn-sm py-1 px-2 delete-comment' data-id='" + data + "'><i class='fas fa-minus-circle'></i></button>";
                    }

                    return html;
                }
            },
            { // User ID
                visible: false
            }
        ]
    });
}

//************* Mosaic Methods ***********************/
function delayedMosaic(page) {
    $("#mosaic").hide();
    $("#mosaic-loading").show();

    setTimeout(function() {
        loadMosaic(page);
    }, 50);
}

function rebuildMosaicPageIndexes() {
    $(".page-index").remove();
    for (var i = 0; i < _mosaicPages + 1; i++) {
        var li = $("<li class='page-item page-index' />").toggleClass("active", i == 0);
        var btn = $("<a class='page-link' />").text(i + 1).attr("data-page", i);

        li.append(btn).insertBefore($(".page-next"));
    }

    $("#bin-paging").show();
}

function enableNextPreviousBinButtons() {
    var prevBin = $("#previous-bin").data("bin");
    $("#previous-bin").toggleClass("disabled", prevBin === "");

    var nextBin = $("#next-bin").data("bin");
    $("#next-bin").toggleClass("disabled", nextBin === "");
}

function loadMosaic(pageNumber) {
    var viewSize = $("#view-size option:selected").val();
    var scaleFactor = $("#scale-factor option:selected").val();

    $("#mosaic-loading").show();
    $("#mosaic").hide();
    _coordinates = [];

    // indicate to the user that coordinates are loading
    $("#mosaic").css("cursor", "wait");

    var binDataUrl = "/api/bin/" + _bin +
        "?view_size=" + viewSize +
        "&scale_factor=" + scaleFactor +
        "&dataset=" + _dataset +
        "&instrument=" + _instrument +
        "&tags=" + _tags;

    $.get(binDataUrl, function(data) {

        // Update the coordinates for the image
        _coordinates = JSON.parse(data["coordinates"]);

        // Indicate to the user that the mosaic is clickable
        $("#mosaic").css("cursor", "pointer");

        // Re-enable next/previous buttons

        if (data.previous_bin_id)
            $("#previous-bin").data("bin", data.previous_bin_id);
        if (data.next_bin_id)
            $("#next-bin").data("bin", data.next_bin_id);

        enableNextPreviousBinButtons();

        // Update the paging
        if (data["num_pages"] != _mosaicPages) {
            _mosaicPages = data["num_pages"];

            rebuildMosaicPageIndexes();
        }

        updateMosaicPaging();

        _isMosaicLoading = false;
    });

    var mosaicUrl = "/api/mosaic/encoded_image/" + _bin +
        "?view_size=" + viewSize +
        "&scale_factor=" + scaleFactor +
        "&page=" + pageNumber;

    $.get(mosaicUrl, function(data) {
        $("#mosaic").attr("src", "data:image/png;base64," + data);
        $("#mosaic-loading").hide();
        $("#mosaic").show();
    }).fail(function(data) {
        $("#mosaic-failed").show();
        $("#mosaic-loading").hide();
        _isMosaicLoading = false;
    });
}

function changeMosaicPage(pageNumber) {
    _mosaicPage = pageNumber;

    delayedMosaic(pageNumber);
    updateMosaicPaging();
}

function updateMosaicPaging() {
    $(".page-previous").toggleClass("disabled", (_mosaicPage <= 0));
    $(".page-next").toggleClass("disabled", (_mosaicPage >= _mosaicPages));

    $.each($(".page-index a"), function() {
        var isSelected = $(this).data("page") == _mosaicPage;

        $(this).closest("li").toggleClass("active", isSelected);
    });

    $("#bin-paging").show();
}

//************* Map Methods ***********************/
function updateMapLocation(data) {
    if (!_map) {
        _map = createMap(data.lat, data.lng);
        _map.on("click", function(e) {
            changeToNearestBin(e.latlng.lat, e.latlng.lng);
        });
    }

    _marker = changeMapLocation(_map, data.lat, data.lng, data.depth, _marker);
    _pendingMapLocation = null;
}

//************* Plotting Methods  ***********************/
function updatePlotVariables(plotData) {
    var plotXAxis = $("#plot-x-axis");
    var plotYAxis = $("#plot-y-axis");
    var selectedX = plotXAxis.val();
    var selectedY = plotYAxis.val();

    plotXAxis.empty();
    plotYAxis.empty();

    var keys = [];
    $.each(plotData, function(key) {
        keys.push(key);
        plotXAxis.append($("<option />").text(key));
        plotYAxis.append($("<option />").text(key));
    });

    plotXAxis.val(keys.includes(selectedX) ? selectedX : PLOT_X_DEFAULT);
    plotYAxis.val(keys.includes(selectedY) ? selectedY : PLOT_Y_DEFAULT);
}

function initPlotData() {
    $.get("/api/plot/" + _bin, function(data) {
        _plotData = data;

        var plotXAxis = $("#plot-x-axis");
        var plotYAxis = $("#plot-y-axis");

        updatePlotVariables(data);

        plotXAxis.val(PLOT_X_DEFAULT);
        plotYAxis.val(PLOT_Y_DEFAULT);

        updatePlot();
    });
}

function updatePlotData() {
    // TODO: The plot container has a hard coded height on it that we should make dynamic. However, doing so causes
    //   the plot, when rendering a second time, to revert back to the minimum height
    $.get("/api/plot/" + _bin, function(data) {
        _plotData = data;

        updatePlotVariables(data);

        updatePlot();
    });
}

//************* Timeline Methods ***********************/

//************* Events ***********************/
function initEvents() {

    // Restore the last bin back to the stack
    $(window).on("popstate", function(e) {
        var state = e.originalEvent.state;

        changeBin(state["bin_id"], false);
    });

    // Open the share dialog window
    $("#share-button").click(function(e) {
        e.preventDefault();

        var link = $("#share-link");
        var base = link.data("scheme") + "://" + link.data("host");

        $("#share-modal").modal();
        $("#share-link").val(base + createLink()).select();
    });

    // Copy the share link to the clipboard
    $("#copy-share-link").click(function(e) {
        e.preventDefault();

        $("#share-link").select();
        document.execCommand("Copy");
    });

    // Changing the view size of the mosaic
    $("#view-size").change(function() {
        var viewSize = $("#view-size").val();
        var vs = viewSize.split("x");
        var height = parseInt(vs[1]);

        $('#mosaic-loading').height(height);

        changeBin(_bin, true);
    });

    // Changing the scale factor for the mosaic
    $("#scale-factor").change(function(e) {
        changeBin(_bin, true);
    });

    // Bin navigation (next/prev)
    $("#previous-bin, #next-bin").click(function(e) {
        e.preventDefault();

        changeBin($(this).data("bin"), true);
    });

    // Mosaic paging
    $("#bin-paging")
        .on("click", ".page-previous", function(e) {
            e.preventDefault();

            if (_mosaicPage > 0)
                changeMosaicPage(_mosaicPage - 1);
        })
        .on("click", ".page-next", function(e) {
            e.preventDefault();

            if (_mosaicPage < _mosaicPages)
                changeMosaicPage(_mosaicPage + 1);
        })
        .on("click", ".page-index a", function(e) {
            e.preventDefault();

            var pageNumber = $(this).data("page")

            changeMosaicPage(pageNumber);
        });

    // Changing the metric shown on the timeline
    $("#ts-tabs .nav-link").click(function() {
        var metric = $(this).data("metric");

        timelineValid = false;
        timelineWaiting = false;
        _preventTimelineRelayout = true;
        createTimeSeries(metric);
    });

    // Showing the plot workspace
    $("#show-plot").click(function(e) {
        showWorkspace("plot");
    });

    // Showing the mosaic workspace
    $("#show-mosaic").click(function(e) {
        showWorkspace("mosaic");
    });

    // Showing the map workspace
    $("#show-map").click(function(e) {
        showWorkspace("map");
    });

    // Add a tag to a bin
    $("#add-tag").click(function(e) {
        toggleTagInput(true);
        $("#tag-name").focus();
    });

    $("#tag-cancel").click(function(e) {
        toggleTagInput(false);
    });

    $("#tag-confirm").click(function(e) {
        addTag();
    });

    $("#tag-name").on("keyup", function(e) {
        if (e.keyCode == 13) {
            addTag();
        }
    });

    // Remove a tag from a bin
    $("#tags").on("click", ".remove-tag", function(e) {
        removeTag($(this).data("tag"));
    });

    $(".show-metadata").click(function(e){
        $("#metadata-header").toggleClass("d-none", false);
        $("#comments-header").toggleClass("d-none", true);
        $("#metadata-panel").toggleClass("d-none", false);
        $("#comments-panel").toggleClass("d-none", true);
    });

    $(".show-comments").click(function(e){
        $("#metadata-header").toggleClass("d-none", true);
        $("#comments-header").toggleClass("d-none", false);
        $("#metadata-panel").toggleClass("d-none", true);
        $("#comments-panel").toggleClass("d-none", false);

        $("#binCommentsTable_wrapper").css("width","100%")
    });

    $("#cancel-comment").click(function(e){
        cancelComment();
    });

    $("#update-comment").click(function(e){
        updateComment();
    });

    $("#confirm-comment").click(function(e){
        addComment();
    });

    $("#binCommentsTable").on("click", ".delete-comment", function(e){
        deleteComment($(this).data("id"));
    });

    $("#binCommentsTable").on("click", ".edit-comment", function(e){
        editComment($(this).data("id"));
    });

    $("#stat-skip").click(function(e){
        if (_userId == null)
            return;

        var skipped = $(this).data("skipped");
        if (!skipped && !confirm("Are you sure you want to mark this bin as skipped?"))
            return;

        var payload = {
            "csrfmiddlewaretoken": _csrf,
            "bin_id": _bin,
            "skipped": skipped
        }

        $.post("/secure/api/toggle-skip", payload, function(resp) {
            $("#stat-skip")
                .text(resp["skipped"] ? "Yes" : "No")
                .data("skipped", resp["skipped"]);
        });
    });
}

//************* Initialization methods and page hooks ***********************/
$(function() {

    // Misc UI elements based on constants
    $("#max-images").text(MAX_SELECTABLE_IMAGES);

    initEvents();
    initPlotData();
    initTimelineFilter();
});
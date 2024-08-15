# Dashboard Metadata (for the public facing dashboard)

### Proposed Dashboard Organization
- Each dataset within the dashboard represents an OOI array
- The only currently existing dataset is associated with the CGSN Pioneer Array
- Each dataset can contain discrete, underway and moored IFCB data outputs


### Metadata Definitions 
- Latitude and longitude: (different for each type)
- Cruise field: (use as Deployment field?)
- Instrument: (instrument #)
- Sample type: ("underway", "discrete", "moored")
- Latitude and longitude populate the metadata csv and are added directly to sample metadata in the dashboard, coords do not appear in the filter or tag options after they are added
      discrete samples: lat and lon coords are taken from the CTD sample log start lat and lon coords 
      underway samples: lat and lon coords per sample are taken from ship data coords matched by datetime stamp within 5 minutes of samples.
      moored samples: lat and lon are taken from the anchor survey coords

  

### Proposed Tags
Targeted sample depths: "surface", "chlorophyll max", "moored ifcb depth"
- depth_surface
- depth_chl_max
- depth_NSIF
- depth_bottom
Nearby site: [within 2 km of a given site center}
- site_CP10CNSM
- site_CP11NOSM
- etc...
Examples of tags from other org's dashboards: (injected_air, wow, cruise numbers, QA tags, test)
Proposed idea: get tag suggestions from the fall workshop, or at least provide a venue for the science community to weight in 





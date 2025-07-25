
// Dream Builder Runtime - Self-contained scene renderer
(async function() {
  const canvas = document.getElementById('renderCanvas');
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  // Show loading
  function showLoading(message) {
    const overlay = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');
    if (overlay && text) {
      overlay.classList.remove('hidden');
      text.textContent = message;
    }
  }

  // Hide loading
  function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  // Show error
  function showError(message) {
    const overlay = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');
    if (overlay && text) {
      overlay.classList.remove('hidden');
      text.innerHTML = '<div class="error"><strong>Error:</strong><br>' + message + '</div>';
    }
  }

  try {
    showLoading('Initializing viewer...');
    
    // Create Babylon.js engine
    const engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    engine.enableOfflineSupport = false;

    // Create scene
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // Transparent background

    showLoading('Loading scene...');
    
    // Load scene graph
    const response = await fetch('scene.json', { 
      cache: 'no-store', 
      headers: { 'Cache-Control': 'no-cache' } 
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch scene: ' + response.status + ' ' + response.statusText);
    }
    
    const sceneGraph = await response.json();
    console.log('Scene graph loaded:', sceneGraph);

    // Validate scene graph
    if (!sceneGraph || !sceneGraph.nodes || !Array.isArray(sceneGraph.nodes)) {
      throw new Error('Invalid scene graph format');
    }

    showLoading('Creating scene objects...');
    
    // Instantiate scene from graph
    await instantiateGraph(sceneGraph, scene);

    showLoading('Preparing scene...');
    
    // Wait for scene to be ready
    await scene.whenReadyAsync();

    // Start render loop
    engine.runRenderLoop(() => {
      if (scene) {
        scene.render();
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (engine) {
        engine.resize();
      }
    });

    // Hide loading overlay
    hideLoading();
    
  } catch (error) {
    showError('Failed to load scene: ' + error.message);
    console.error('Runtime error:', error);
  }

  // Instantiate scene graph (adapted from viewer.js)
  async function instantiateGraph(graph, scene) {
    console.log('🏗️ Instantiating scene graph with', graph.nodes.length, 'nodes');
    
    for (const node of graph.nodes) {
      await instantiateNode(node, scene);
    }
    
    console.log('✅ Graph instantiation complete');
  }

  async function instantiateNode(node, scene) {
    const position = new BABYLON.Vector3(...node.transform.position);
    const rotation = node.transform.rotation ? new BABYLON.Vector3(...node.transform.rotation) : BABYLON.Vector3.Zero();
    const scaling = node.transform.scaling ? new BABYLON.Vector3(...node.transform.scaling) : BABYLON.Vector3.One();

    try {
      switch (node.kind) {
        case 'camera':
          const camera = new BABYLON.ArcRotateCamera(
            node.id,
            -Math.PI / 2,
            Math.PI / 2.5,
            position.length() || 10,
            BABYLON.Vector3.Zero(),
            scene
          );
          camera.setTarget(BABYLON.Vector3.Zero());
          camera.attachControl(canvas, true);
          
          // Apply enabled state
          const cameraEnabled = node.enabled !== false;
          camera.setEnabled(cameraEnabled);
          break;

        case 'light':
          const light = new BABYLON.HemisphericLight(node.id, new BABYLON.Vector3(0, 1, 0), scene);
          light.intensity = 0.7;
          
          // Apply enabled state
          const lightEnabled = node.enabled !== false;
          light.setEnabled(lightEnabled);
          break;

        case 'mesh':
          let mesh = null;
          if (node.id === 'defaultCube') {
            mesh = BABYLON.MeshBuilder.CreateBox(node.id, { size: 2 }, scene);
            mesh.position = position;
            mesh.rotation = rotation;
            mesh.scaling = scaling;
          } else if (node.id === 'ground') {
            mesh = BABYLON.MeshBuilder.CreateGround(node.id, { width: 6, height: 6 }, scene);
            mesh.position = position;
            mesh.rotation = rotation;
            mesh.scaling = scaling;
          }
          
          // Apply visibility and enabled states
          if (mesh) {
            const visible = node.visible !== false;
            const enabled = node.enabled !== false;
            mesh.setEnabled(enabled);
            mesh.visibility = visible ? 1 : 0;
          }
          break;

        case 'model':
          if (node.src) {
            await loadModelFromAssets(node, scene);
          }
          break;
      }
    } catch (error) {
      console.error('Failed to instantiate node ' + node.id + ':', error);
    }
  }

  async function loadModelFromAssets(node, scene) {
    if (!scene || !node.src) return;

    try {
      // Convert storage path to asset path
      const assetPath = 'assets/' + toRelativeAssetPath(node.src);
      console.log('🔗 Loading model from:', assetPath);
      
      // Load the asset container
      const result = await BABYLON.SceneLoader.LoadAssetContainerAsync('', assetPath, scene);
      
      if (result.meshes.length > 0) {
        // Create a parent transform node
        const parentNode = new BABYLON.TransformNode(node.id, scene);
        parentNode.position = new BABYLON.Vector3(...node.transform.position);
        
        if (node.transform.rotation) {
          parentNode.rotation = new BABYLON.Vector3(...node.transform.rotation);
        }
        if (node.transform.scaling) {
          parentNode.scaling = new BABYLON.Vector3(...node.transform.scaling);
        }

        // Parent all loaded meshes to the transform node
        result.meshes.forEach(mesh => {
          mesh.parent = parentNode;
        });

        // Apply visibility and enabled states
        const visible = node.visible !== false;
        const enabled = node.enabled !== false;
        parentNode.setEnabled(enabled);
        result.meshes.forEach(mesh => {
          mesh.setEnabled(enabled);
          mesh.visibility = visible ? 1 : 0;
        });

        // Add to scene
        result.addAllToScene();
        
        console.log('✅ Model loaded successfully:', node.name);
      }
    } catch (error) {
      console.error('❌ Failed to load model ' + node.name + ':', error);
    }
  }

  // Convert storage path to relative asset path (matches exportWebBasic.ts)
  function toRelativeAssetPath(storagePath) {
    // Extract just the filename from the path (same logic as export)
    const parts = storagePath.split('/');
    const filename = parts[parts.length - 1];
    return filename || storagePath.replace(/[/\\]/g, '_');
  }

})();